// COOP P2P: opt-in original Rust player order claim/finalize.
// Included inside pinned market-server/src/state.rs (not an independent market).
// Exactly one in-flight claim per Rust order, no automatic abort after uncertainty.
fn coop_p2p_enabled() -> Result<()> {
    if std::env::var("EVEJS_COOP_RUST_P2P_CLAIM")
        .ok().as_deref() != Some("1") {
        bail!("P2P_RUST_CLAIM_DISABLED");
    }
    Ok(())
}
fn coop_p2p_schema(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS coop_p2p_fill_claims (
            order_id INTEGER NOT NULL,
            cycle INTEGER NOT NULL,
            buyer_id INTEGER NOT NULL,
            seller_id INTEGER NOT NULL,
            owner_id INTEGER NOT NULL,
            station_id INTEGER NOT NULL,
            type_id INTEGER NOT NULL,
            bid INTEGER NOT NULL,
            price_cents INTEGER NOT NULL,
            volume_before INTEGER NOT NULL,
            filled_quantity INTEGER NOT NULL,
            volume_after INTEGER NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('claimed','finalized','released')),
            ack_json TEXT,
            native_receipt_key TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(order_id,cycle)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS coop_p2p_one_active_fill
        ON coop_p2p_fill_claims(order_id) WHERE phase='claimed';"
    )?;
    Ok(())
}
fn coop_p2p_claim_db(
    path:&Path, order_id:i64, cycle:i64, buyer_id:u64, seller_id:u64,
    volume_before:u64, filled_quantity:u64, price_cents:i64
)->Result<serde_json::Value> {
    coop_p2p_enabled()?;
    if order_id<=0 || cycle<=0 || buyer_id==0 || seller_id==0 ||
       buyer_id==seller_id || volume_before==0 || filled_quantity==0 ||
       filled_quantity>volume_before || price_cents<=0 {
        bail!("P2P_CLAIM_IDENTITY_OR_VOLUME_INVALID");
    }
    let mut db=load_connection(path)?;
    coop_p2p_schema(&db)?;
    let tx=db.transaction()?;
    let existing=tx.query_row(
        "SELECT buyer_id,seller_id,volume_before,filled_quantity,price_cents,phase
         FROM coop_p2p_fill_claims WHERE order_id=?1 AND cycle=?2",
        params![order_id,cycle],
        |r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?,
              r.get::<_,u64>(2)?,r.get::<_,u64>(3)?,
              r.get::<_,i64>(4)?,r.get::<_,String>(5)?))
    ).optional()?;
    if let Some((old_buyer,old_seller,old_before,old_filled,old_price,phase))=existing {
        if (old_buyer,old_seller,old_before,old_filled,old_price) !=
           (buyer_id,seller_id,volume_before,filled_quantity,price_cents) {
            bail!("P2P_CLAIM_REPLAY_PAYLOAD_MISMATCH");
        }
        tx.commit()?;
        return Ok(serde_json::json!({
            "order_id":order_id.to_string(),"cycle":cycle,"phase":phase,
            "buyer_id":buyer_id,"seller_id":seller_id
        }));
    }
    let (owner,corp,source,bid,price,remaining,station,type_id,region,solar,min_volume,state)=
      tx.query_row(
        "SELECT owner_id,is_corp,source,bid,price,vol_remaining,station_id,
                type_id,region_id,solar_system_id,min_volume,state
         FROM market_orders WHERE order_id=?1",
        params![order_id],
        |r|Ok((r.get::<_,u64>(0)?,r.get::<_,i64>(1)?,
              r.get::<_,String>(2)?,r.get::<_,i64>(3)?,
              r.get::<_,f64>(4)?,r.get::<_,u64>(5)?,
              r.get::<_,u64>(6)?,r.get::<_,u32>(7)?,
              r.get::<_,u32>(8)?,r.get::<_,u32>(9)?,
              r.get::<_,u64>(10)?,r.get::<_,String>(11)?))
      )?;
    if corp!=0 || source!="player" || state!="open" ||
       !((bid==1&&owner==buyer_id)||(bid==0&&owner==seller_id)) ||
       station==0 || type_id==0 || region==0 || solar==0 ||
       remaining!=volume_before || min_volume==0 ||
       !(filled_quantity>=min_volume ||
         (remaining<min_volume&&filled_quantity==remaining)) {
        bail!("P2P_CLAIM_NATIVE_ORDER_NOT_ELIGIBLE");
    }
    let actual=price*100.0;
    if !actual.is_finite() || actual<=0.0 ||
       (actual.round()-actual).abs()>0.000001 ||
       actual.round() > (i64::MAX as f64) ||
       actual.round() as i64 != price_cents {
        bail!("P2P_CLAIM_EXACT_PRICE_MISMATCH");
    }
    let prior:Option<i64>=tx.query_row(
        "SELECT MAX(cycle) FROM coop_p2p_fill_claims WHERE order_id=?1",
        params![order_id],|r|r.get(0)
    )?;
    let expected_cycle=prior.unwrap_or(0).checked_add(1)
        .ok_or_else(||anyhow!("P2P_CLAIM_CYCLE_OVERFLOW"))?;
    if cycle!=expected_cycle {bail!("P2P_CLAIM_CYCLE_NOT_NEXT");}
    let claim_count=tx.execute(
        "UPDATE market_orders SET state='settling',updated_at=?2
         WHERE order_id=?1 AND state='open' AND source='player'
               AND vol_remaining=?3",
        params![order_id,now_rfc3339(),volume_before]
    )?;
    if claim_count!=1 {bail!("P2P_CLAIM_EXCLUSIVE_ORDER_LOCK_FAILED");}
    let next=volume_before-filled_quantity;
    tx.execute(
        "INSERT INTO coop_p2p_fill_claims
         (order_id,cycle,buyer_id,seller_id,owner_id,station_id,type_id,
          bid,price_cents,volume_before,filled_quantity,volume_after,phase,
          ack_json,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'claimed',NULL,?13,?13)",
        params![order_id,cycle,buyer_id,seller_id,owner,station,type_id,
                bid,price_cents,volume_before,filled_quantity,next,now_rfc3339()]
    )?;
    tx.commit()?;
    Ok(serde_json::json!({
        "order_id":order_id.to_string(),"cycle":cycle,"phase":"claimed",
        "buyer_id":buyer_id,"seller_id":seller_id,
        "volume_before":volume_before,"filled_quantity":filled_quantity,
        "volume_after":next
    }))
}
fn coop_p2p_finalize_db(path:&Path,order_id:i64,cycle:i64,
    buyer_id:u64,seller_id:u64
)->Result<serde_json::Value>{
    coop_p2p_enabled()?;
    if order_id<=0||cycle<=0||buyer_id==0||seller_id==0||buyer_id==seller_id{
        bail!("P2P_FINALIZE_IDENTITY_INVALID");
    }
    let mut db=load_connection(path)?;
    coop_p2p_schema(&db)?;
    let tx=db.transaction()?;
    let claim=tx.query_row(
        "SELECT buyer_id,seller_id,owner_id,station_id,type_id,bid,
                price_cents,volume_before,filled_quantity,volume_after,phase,ack_json
         FROM coop_p2p_fill_claims WHERE order_id=?1 AND cycle=?2",
        params![order_id,cycle],
        |r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?,
              r.get::<_,u64>(2)?,r.get::<_,u64>(3)?,
              r.get::<_,u32>(4)?,r.get::<_,i64>(5)?,
              r.get::<_,i64>(6)?,r.get::<_,u64>(7)?,
              r.get::<_,u64>(8)?,r.get::<_,u64>(9)?,
              r.get::<_,String>(10)?,r.get::<_,Option<String>>(11)?))
    ).optional()?.ok_or_else(||anyhow!("P2P_FINALIZE_CLAIM_NOT_FOUND"))?;
    let (buyer,seller,owner,station,type_id,bid,price_cents,before,quantity,after,phase,old_ack)=claim;
    if buyer!=buyer_id||seller!=seller_id {
        bail!("P2P_FINALIZE_COUNTERPARTY_MISMATCH");
    }
    if phase=="finalized" || phase=="released" {
        let ack=old_ack.ok_or_else(||anyhow!("P2P_FINALIZE_MISSING_DURABLE_ACK"))?;
        let value=serde_json::from_str::<serde_json::Value>(&ack)?;
        tx.commit()?;
        return Ok(value);
    }
    if phase!="claimed"||old_ack.is_some(){bail!("P2P_FINALIZE_INVALID_CLAIM_PHASE");}
    let row=tx.query_row(
        "SELECT owner_id,is_corp,source,bid,price,vol_remaining,state,
                region_id,solar_system_id,station_id,type_id
         FROM market_orders WHERE order_id=?1",
        params![order_id],
        |r|Ok((r.get::<_,u64>(0)?,r.get::<_,i64>(1)?,
            r.get::<_,String>(2)?,r.get::<_,i64>(3)?,
            r.get::<_,f64>(4)?,r.get::<_,u64>(5)?,
            r.get::<_,String>(6)?,r.get::<_,u32>(7)?,
            r.get::<_,u32>(8)?,r.get::<_,u64>(9)?,
            r.get::<_,u32>(10)?))
    )?;
    let (now_owner,corp,source,now_bid,price,remaining,state,region,solar,now_station,now_type)=row;
    if state!="settling"||source!="player"||corp!=0||
       now_owner!=owner||now_bid!=bid||remaining!=before||
       now_station!=station||now_type!=type_id ||
       !price.is_finite()||(price*100.0-(price_cents as f64)).abs()>0.000001 {
        bail!("P2P_FINALIZE_ORDER_CHANGED_AFTER_CLAIM");
    }
    let next_state=if after==0{"filled"}else{"open"};
    let timestamp=now_rfc3339();
    let changed=tx.execute(
        "UPDATE market_orders SET vol_remaining=?3,updated_at=?4
         WHERE order_id=?1 AND state='settling' AND vol_remaining=?2
           AND source='player'",
        params![order_id,before,after,timestamp]
    )?;
    if changed!=1 {bail!("P2P_FINALIZE_EXCLUSIVE_ORDER_UPDATE_FAILED");}
    let ack=serde_json::json!({
        "order_id":order_id.to_string(),"owner_id":owner,"is_corp":false,
        "region_id":region,"solar_system_id":solar,"station_id":station,
        "type_id":type_id,"bid":bid==1,"price":price,
        "filled_quantity":quantity,"vol_remaining":after,
        "state":next_state,"invalidated":true,"release_pending":true
    });
    let changed=tx.execute(
        "UPDATE coop_p2p_fill_claims
         SET phase='finalized',ack_json=?3,updated_at=?4
         WHERE order_id=?1 AND cycle=?2 AND phase='claimed'",
        params![order_id,cycle,ack.to_string(),timestamp]
    )?;
    if changed!=1 {bail!("P2P_FINALIZE_CLAIM_RECEIPT_MISSING");}
    tx.commit()?;
    Ok(ack)
}
// Release follows the durable GameStore receipt AND native journal SETTLED.
// Rust cannot read GameStore; the trusted server must independently validate
// its own persisted receipt before presenting the receipt key here.
fn coop_p2p_release_db(path:&Path,order_id:i64,cycle:i64,
 buyer_id:u64,seller_id:u64,receipt_key:String)->Result<serde_json::Value>{
 coop_p2p_enabled()?;
 if order_id<=0 || cycle<=0 || buyer_id==0 || seller_id==0 ||
    buyer_id==seller_id ||
    receipt_key!=format!("p2p:{}:{}",order_id,cycle){
    bail!("P2P_RELEASE_IDENTITY_OR_RECEIPT_KEY_INVALID");
 }
 let mut db=load_connection(path)?;
 coop_p2p_schema(&db)?;
 let tx=db.transaction()?;
 let claim=tx.query_row(
   "SELECT buyer_id,seller_id,owner_id,phase,volume_after,
     ack_json,native_receipt_key FROM coop_p2p_fill_claims
    WHERE order_id=?1 AND cycle=?2",
   params![order_id,cycle],
   |r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?,
     r.get::<_,u64>(2)?,r.get::<_,String>(3)?,
     r.get::<_,u64>(4)?,r.get::<_,Option<String>>(5)?,
     r.get::<_,Option<String>>(6)?))
 ).optional()?.ok_or_else(||anyhow!("P2P_RELEASE_CLAIM_NOT_FOUND"))?;
 let (buyer,seller,owner,phase,after,ack,old_key)=claim;
 if buyer!=buyer_id||seller!=seller_id{
    bail!("P2P_RELEASE_PARTICIPANT_MISMATCH");
 }
 let stored=ack.ok_or_else(||anyhow!("P2P_RELEASE_FILL_ACK_MISSING"))?;
 let v:serde_json::Value=serde_json::from_str(&stored)?;
 let state=if after==0 {"filled"} else {"open"};
 if phase=="released"{
    if old_key.as_deref()!=Some(receipt_key.as_str()){
       bail!("P2P_RELEASE_RECEIPT_REPLAY_MISMATCH");
    }
    tx.commit()?;
    return Ok(serde_json::json!({
      "order_id":order_id.to_string(),"cycle":cycle,
      "state":state,"phase":"released","native_receipt_key":receipt_key,
      "ack":v
    }));
 }
 if phase!="finalized" || old_key.is_some() ||
    v.get("release_pending")!=Some(&serde_json::Value::Bool(true)){
    bail!("P2P_RELEASE_MUST_FOLLOW_FINALIZED_RUST_FILL");
 }
 let row=tx.query_row(
    "SELECT owner_id,source,vol_remaining,state FROM market_orders
     WHERE order_id=?1",params![order_id],
    |r|Ok((r.get::<_,u64>(0)?,r.get::<_,String>(1)?,
         r.get::<_,u64>(2)?,r.get::<_,String>(3)?))
 )?;
 if row!=(owner,"player".to_string(),after,"settling".to_string()){
    bail!("P2P_RELEASE_RUST_ORDER_NOT_LOCKED");
 }
 let timestamp=now_rfc3339();
 let n=tx.execute(
   "UPDATE market_orders SET state=?2,updated_at=?3,
    last_state_change_at=CASE WHEN ?2='filled' THEN ?3 ELSE last_state_change_at END
    WHERE order_id=?1 AND state='settling' AND vol_remaining=?4",
   params![order_id,state,timestamp,after]
 )?;
 if n!=1{bail!("P2P_RELEASE_RUST_ORDER_CHANGED");}
 let n=tx.execute(
   "UPDATE coop_p2p_fill_claims
     SET phase='released',native_receipt_key=?3,updated_at=?4
    WHERE order_id=?1 AND cycle=?2 AND phase='finalized'",
   params![order_id,cycle,receipt_key,timestamp]
 )?;
 if n!=1{bail!("P2P_RELEASE_CLAIM_CHANGED");}
 tx.commit()?;
 Ok(serde_json::json!({
   "order_id":order_id.to_string(),"cycle":cycle,
   "state":state,"phase":"released","native_receipt_key":receipt_key,
   "ack":v
 }))
}
fn coop_p2p_get_claim_db(path:&Path,order_id:i64,cycle:i64)
 ->Result<serde_json::Value>{
    coop_p2p_enabled()?;
    if order_id<=0||cycle<=0{bail!("P2P_GET_CLAIM_ID_INVALID");}
    let db=load_connection(path)?;
    coop_p2p_schema(&db)?;
    let row=db.query_row(
        "SELECT buyer_id,seller_id,phase,volume_before,filled_quantity,
                volume_after,ack_json FROM coop_p2p_fill_claims
         WHERE order_id=?1 AND cycle=?2",
        params![order_id,cycle],
        |r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?,
               r.get::<_,String>(2)?,r.get::<_,u64>(3)?,
               r.get::<_,u64>(4)?,r.get::<_,u64>(5)?,
               r.get::<_,Option<String>>(6)?))
    ).optional()?;
    Ok(match row {
        None=>serde_json::Value::Null,
        Some((buyer,seller,phase,before,filled,after,ack))=>
           serde_json::json!({
            "order_id":order_id.to_string(),"cycle":cycle,
            "buyer_id":buyer,"seller_id":seller,"phase":phase,
            "volume_before":before,"filled_quantity":filled,
            "volume_after":after,
            "ack":ack.map(|v|serde_json::from_str::<serde_json::Value>(&v)).transpose()?
           })
    })
}
impl MarketRuntime {
    pub async fn coop_p2p_claim(
       &self,order_id:i64,cycle:i64,buyer:u64,seller:u64,
       before:u64,quantity:u64,price_cents:i64
    )->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let v=tokio::task::spawn_blocking(move||
          coop_p2p_claim_db(&path,order_id,cycle,buyer,seller,before,quantity,price_cents)
        ).await.context("P2P claim task join failed")??;
        let order=self.get_order(order_id).await?;
        self.invalidate_scope_caches(order.row.region_id,
          order.row.solar_system_id,order.row.station_id,order.row.type_id).await;
        self.refresh_region_summary_row(order.row.region_id,order.row.type_id).await?;
        Ok(v)
    }
    pub async fn coop_p2p_finalize(
       &self,order_id:i64,cycle:i64,buyer:u64,seller:u64
    )->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let v=tokio::task::spawn_blocking(move||
            coop_p2p_finalize_db(&path,order_id,cycle,buyer,seller)
        ).await.context("P2P finalize task join failed")??;
        let order=self.get_order(order_id).await?;
        self.invalidate_scope_caches(order.row.region_id,
          order.row.solar_system_id,order.row.station_id,order.row.type_id).await;
        self.refresh_region_summary_row(order.row.region_id,order.row.type_id).await?;
        Ok(v)
    }
    pub async fn coop_p2p_release(
      &self,order_id:i64,cycle:i64,buyer:u64,seller:u64,
      receipt_key:String
    )->Result<serde_json::Value>{
      let path=self.database_path.clone();
      let result=tokio::task::spawn_blocking(move||
        coop_p2p_release_db(&path,order_id,cycle,buyer,seller,receipt_key)
      ).await.context("P2P release task join failed")??;
      let order=self.get_order(order_id).await?;
      self.invalidate_scope_caches(order.row.region_id,
        order.row.solar_system_id,order.row.station_id,order.row.type_id).await;
      self.refresh_region_summary_row(order.row.region_id,order.row.type_id).await?;
      Ok(result)
    }
    pub async fn coop_p2p_get_claim(
       &self,order_id:i64,cycle:i64
    )->Result<serde_json::Value>{
        let path=self.database_path.clone();
        tokio::task::spawn_blocking(move||
           coop_p2p_get_claim_db(&path,order_id,cycle)
        ).await.context("P2P query task join failed")?
    }
}
