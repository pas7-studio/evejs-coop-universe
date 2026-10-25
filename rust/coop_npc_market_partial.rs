// COOP-047: native Rust partial NPC-corporation sell claim and finalize.
// Included only by reversible pinned overlay, default OFF.
// Rust holds SETTLING until a verified GameStore six-table receipt is committed.
const COOP_NPC_PARTIAL_FILL_BASE:i64=910_000_000_000_000;
fn coop_npc_partial_gate(op:&str,claim:&str)->Result<()>{
    coop_npc_fill_gate(op)?;
    if std::env::var("EVEJS_COOP_RUST_NPC_PARTIAL_FILL").ok().as_deref()!=Some("1"){
        bail!("NPC native partial settlement disabled");
    }
    let Some(token)=claim.strip_prefix("npc-partial:") else {
        bail!("NPC partial claim key invalid");
    };
    if token.len()!=32||!token.bytes().all(|b|
        b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        bail!("NPC partial claim key invalid");
    }
    Ok(())
}
fn coop_npc_partial_schema(db:&Connection)->Result<()>{
    db.execute_batch(
      "CREATE TABLE IF NOT EXISTS coop_npc_partial_claims(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        claim_key TEXT UNIQUE NOT NULL,
        order_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        fill_quantity INTEGER NOT NULL,
        remaining_before INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        phase TEXT NOT NULL DEFAULT 'claimed',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_coop_npc_partial_order
      ON coop_npc_partial_claims(order_id);"
    )?;
    Ok(())
}
fn coop_npc_partial_value(db:&Connection,op:&str,claim:&str)
 ->Result<Option<serde_json::Value>>{
    let Some(mut base)=coop_npc_row(db,op)? else{return Ok(None)};
    let result=db.query_row(
      "SELECT id,order_id,buyer_id,fill_quantity,remaining_before,
              unit_price_cents,phase
       FROM coop_npc_partial_claims WHERE claim_key=?1",
      params![claim],
      |r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,
        r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,
        r.get::<_,i64>(5)?,r.get::<_,String>(6)?))
    ).optional()?;
    let Some((id,order,buyer,qty,before,price,phase))=result else{
        return Ok(None);
    };
    if base["order_id"]!=order.to_string()||
       qty<=0||before<=0||qty>before||price<=0{
       bail!("NPC partial persisted claim identity corrupt");
    }
    let fill_id=COOP_NPC_PARTIAL_FILL_BASE.checked_add(id)
       .ok_or_else(||anyhow!("NPC partial fill id overflow"))?;
    base["claim_key"]=serde_json::json!(claim);
    base["fill_id"]=serde_json::json!(fill_id.to_string());
    base["buyer_id"]=serde_json::json!(buyer.to_string());
    base["fill_quantity"]=serde_json::json!(qty);
    base["remaining_before"]=serde_json::json!(before);
    base["remaining_after"]=serde_json::json!(before-qty);
    base["price_cents"]=serde_json::json!(price);
    base["fill_phase"]=serde_json::json!(phase);
    Ok(Some(base))
}
fn coop_npc_partial_claim_db(path:&Path,op:&str,claim:&str,
 order_id:i64,buyer_id:i64,quantity:i64)->Result<serde_json::Value>{
    coop_npc_partial_gate(op,claim)?;
    if order_id<=0||buyer_id<=0||quantity<=0||quantity>50000{
        bail!("NPC partial buyer/order/quantity invalid");
    }
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;coop_npc_partial_schema(&db)?;
    let tx=db.transaction()?;
    if let Some(previous)=coop_npc_partial_value(&tx,op,claim)?{
        if previous["order_id"]!=order_id.to_string()||
           previous["buyer_id"]!=buyer_id.to_string()||
           previous["fill_quantity"]!=quantity{
           bail!("NPC partial claim key identity mismatch");
        }
        tx.commit()?;
        return Ok(previous);
    }
    let original=coop_npc_row(&tx,op)?
        .ok_or_else(||anyhow!("NPC partial sell order missing"))?;
    if original["source"]!="coop-npc"||original["is_corp"]!=true||
       original["bid"]!=false||original["state"]!="open"||
       original["order_id"]!=order_id.to_string(){
       bail!("NPC partial order unavailable or already claimed");
    }
    let remaining=original["vol_remaining"].as_i64()
        .ok_or_else(||anyhow!("NPC partial remaining invalid"))?;
    if remaining<=0||remaining<quantity{
        bail!("NPC partial insufficient remaining stack");
    }
    let price=original["price"].as_f64()
        .ok_or_else(||anyhow!("NPC partial price missing"))?;
    if !price.is_finite()||price<=0.0||price>1_000_000.0{
        bail!("NPC partial native price invalid");
    }
    let cents=(price*100.0).round();
    if cents<=0.0||cents>100_000_000.0{
        bail!("NPC partial cents overflow");
    }
    let now=now_rfc3339();
    let changed=tx.execute(
       "UPDATE market_orders SET state='settling',
          updated_at=?2,last_state_change_at=?2
        WHERE order_id=?1 AND state='open' AND source='coop-npc'
          AND bid=0 AND vol_remaining>=?3",
       params![order_id,now,quantity])?;
    if changed!=1{bail!("NPC partial concurrent market claim rejected");}
    tx.execute(
       "INSERT INTO coop_npc_partial_claims(
        claim_key,order_id,buyer_id,fill_quantity,remaining_before,
        unit_price_cents,phase,created_at)
        VALUES(?1,?2,?3,?4,?5,?6,'claimed',?7)",
       params![claim,order_id,buyer_id,quantity,remaining,cents as i64,now])?;
    let result=coop_npc_partial_value(&tx,op,claim)?
        .ok_or_else(||anyhow!("NPC partial durable claim disappeared"))?;
    if result["state"]!="settling"||result["fill_phase"]!="claimed"{
        bail!("NPC partial Rust claim not locked");
    }
    tx.commit()?;
    Ok(result)
}
fn coop_npc_partial_finalize_db(path:&Path,op:&str,claim:&str,
 order_id:i64,buyer_id:i64,fill_id:i64,quantity:i64)
 ->Result<(serde_json::Value,bool)>{
    coop_npc_partial_gate(op,claim)?;
    if order_id<=0||buyer_id<=0||quantity<=0||
       fill_id<=COOP_NPC_PARTIAL_FILL_BASE{
       bail!("NPC partial finalize ID invalid");
    }
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;coop_npc_partial_schema(&db)?;
    let tx=db.transaction()?;
    let previous=coop_npc_partial_value(&tx,op,claim)?
        .ok_or_else(||anyhow!("NPC partial finalize claim missing"))?;
    if previous["order_id"]!=order_id.to_string()||
       previous["buyer_id"]!=buyer_id.to_string()||
       previous["fill_id"]!=fill_id.to_string()||
       previous["fill_quantity"]!=quantity{
        bail!("NPC partial finalize claim identity mismatch");
    }
    if previous["fill_phase"]=="finalized"{
        let current=previous["vol_remaining"].as_i64()
          .ok_or_else(||anyhow!("NPC partial finalized remaining invalid"))?;
        let original=previous["remaining_before"].as_i64()
          .ok_or_else(||anyhow!("NPC partial finalized amount invalid"))?;
        if current>original-quantity{
            bail!("NPC partial finalize contradictory replay");
        }
        tx.commit()?;return Ok((previous,false));
    }
    if previous["state"]!="settling"||previous["fill_phase"]!="claimed"{
        bail!("NPC partial fill not claimed");
    }
    let before=previous["remaining_before"].as_i64()
        .ok_or_else(||anyhow!("NPC partial original remaining invalid"))?;
    let next=before.checked_sub(quantity)
        .ok_or_else(||anyhow!("NPC partial remaining underflow"))?;
    if next<0{bail!("NPC partial negative remaining");}
    let now=now_rfc3339();
    let updated=tx.execute(
      "UPDATE market_orders SET vol_remaining=?2,
        state=CASE WHEN ?2=0 THEN 'filled' ELSE 'open' END,
        updated_at=?3,last_state_change_at=?3
       WHERE order_id=?1 AND source='coop-npc' AND state='settling'
         AND vol_remaining=?4",
      params![order_id,next,now,before])?;
    if updated!=1{bail!("NPC partial Rust remaining not conserved");}
    let receipt=tx.execute(
      "UPDATE coop_npc_partial_claims SET phase='finalized'
       WHERE claim_key=?1 AND phase='claimed' AND order_id=?2",
      params![claim,order_id])?;
    if receipt!=1{bail!("NPC partial Rust fill receipt not finalized");}
    let done=coop_npc_partial_value(&tx,op,claim)?
        .ok_or_else(||anyhow!("NPC partial Rust completion missing"))?;
    tx.commit()?;
    Ok((done,true))
}
impl MarketRuntime{
    pub async fn coop_npc_claim_partial(&self,op:String,claim:String,
        order_id:i64,buyer_id:i64,quantity:i64)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let row=tokio::task::spawn_blocking(move ||
          coop_npc_partial_claim_db(&path,&op,&claim,order_id,buyer_id,quantity))
          .await.context("NPC partial Rust claim worker failed")??;
        let region=u32::try_from(row["region_id"].as_u64().ok_or_else(||anyhow!("region missing"))?)?;
        let solar=u32::try_from(row["solar_system_id"].as_u64().ok_or_else(||anyhow!("solar missing"))?)?;
        let station=row["station_id"].as_u64().ok_or_else(||anyhow!("station missing"))?;
        let ty=u32::try_from(row["type_id"].as_u64().ok_or_else(||anyhow!("type missing"))?)?;
        self.invalidate_scope_caches(region,solar,station,ty).await;
        self.refresh_region_summary_row(region,ty).await?;
        Ok(row)
    }
    pub async fn coop_npc_get_partial(&self,op:String,claim:String)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        tokio::task::spawn_blocking(move ||{
            let db=load_connection(&path)?;
            coop_npc_ensure(&db)?;coop_npc_partial_schema(&db)?;
            coop_npc_partial_gate(&op,&claim)?;
            coop_npc_partial_value(&db,&op,&claim)?
              .ok_or_else(||anyhow!("NPC partial Rust claim missing"))
        }).await.context("NPC partial inspect worker failed")?
    }
    pub async fn coop_npc_finalize_partial(&self,op:String,claim:String,
        order_id:i64,buyer_id:i64,fill_id:i64,quantity:i64)
     ->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let (row,changed)=tokio::task::spawn_blocking(move ||
           coop_npc_partial_finalize_db(&path,&op,&claim,order_id,buyer_id,fill_id,quantity))
          .await.context("NPC partial Rust finalize worker failed")??;
        if changed {
            let region=u32::try_from(row["region_id"].as_u64().ok_or_else(||anyhow!("region missing"))?)?;
            let solar=u32::try_from(row["solar_system_id"].as_u64().ok_or_else(||anyhow!("solar missing"))?)?;
            let station=row["station_id"].as_u64().ok_or_else(||anyhow!("station missing"))?;
            let ty=u32::try_from(row["type_id"].as_u64().ok_or_else(||anyhow!("type missing"))?)?;
            self.invalidate_scope_caches(region,solar,station,ty).await;
            self.refresh_region_summary_row(region,ty).await?;
        }
        Ok(row)
    }
}
