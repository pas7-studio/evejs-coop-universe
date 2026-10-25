// COOP-048: NPC CORPORATION buys exactly the remaining stock of one PLAYER ask.
// Rust durable CLAIM -> GameStore atomic player credit + NPC corporate debit +
// physical escrow-to-corporate-hangar transfer -> Rust FINALIZE.
// Separate from COOP-035/047 NPC-as-seller protocols. Default OFF.
const COOP_NPC_CORP_BUY_FILL_BASE:i64=930_000_000_000_000;

fn coop_npc_corp_buy_gate(key:&str)->Result<()>{
    if std::env::var("EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER").ok().as_deref()!=Some("1"){
        bail!("NPC corporation buy from player disabled");
    }
    let Some(token)=key.strip_prefix("npc-corpbuy:") else {
        bail!("NPC corporation purchase key invalid");
    };
    if token.len()!=32||!token.bytes().all(|b|
       b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        bail!("NPC corporation purchase key invalid");
    }
    Ok(())
}
fn coop_npc_corp_buy_schema(db:&Connection)->Result<()>{
    db.execute_batch(
       "CREATE TABLE IF NOT EXISTS coop_npc_corp_buy_claims(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          claim_key TEXT UNIQUE NOT NULL,
          order_id INTEGER UNIQUE NOT NULL,
          buyer_corp_id INTEGER NOT NULL,
          seller_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price_cents INTEGER NOT NULL,
          phase TEXT NOT NULL DEFAULT 'claimed',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS coop_npc_corp_buy_history(
          claim_key TEXT PRIMARY KEY,
          fill_id INTEGER UNIQUE NOT NULL,
          order_id INTEGER UNIQUE NOT NULL,
          type_id INTEGER NOT NULL,
          price_cents INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          history_day TEXT NOT NULL,
          recorded_at TEXT NOT NULL
        );"
    )?;
    Ok(())
}
fn coop_npc_corp_buy_value(db:&Connection,key:&str)->Result<Option<serde_json::Value>>{
    let row=db.query_row(
      "SELECT f.id,f.order_id,f.buyer_corp_id,f.seller_id,f.quantity,
         f.unit_price_cents,f.phase,
         o.owner_id,o.station_id,o.region_id,o.solar_system_id,o.type_id,
         o.source,o.state,o.bid,o.is_corp,o.vol_remaining,
         h.history_day
       FROM coop_npc_corp_buy_claims f
       JOIN market_orders o ON o.order_id=f.order_id
       LEFT JOIN coop_npc_corp_buy_history h ON h.claim_key=f.claim_key
       WHERE f.claim_key=?1",
       params![key],
       |r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,
         r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,
         r.get::<_,i64>(4)?,r.get::<_,i64>(5)?,
         r.get::<_,String>(6)?,r.get::<_,i64>(7)?,
         r.get::<_,i64>(8)?,r.get::<_,i64>(9)?,
         r.get::<_,i64>(10)?,r.get::<_,i64>(11)?,
         r.get::<_,String>(12)?,r.get::<_,String>(13)?,
         r.get::<_,i64>(14)?,r.get::<_,i64>(15)?,
         r.get::<_,i64>(16)?,r.get::<_,Option<String>>(17)?))
    ).optional()?;
    let Some((id,order,buyer,seller,quantity,price,phase,owner,station,
      region,solar,ty,source,state,bid,is_corp,remaining,history_day))=row else{
        return Ok(None);
    };
    if buyer<=0||seller<=0||owner!=seller||quantity<=0||price<=0||
       bid!=0||is_corp!=0||source!="player"{
        bail!("NPC corporation market claim data corrupt");
    }
    let fill=COOP_NPC_CORP_BUY_FILL_BASE.checked_add(id)
      .ok_or_else(||anyhow!("NPC corporation fill ID overflow"))?;
    Ok(Some(serde_json::json!({
      "claim_key":key,"fill_id":fill.to_string(),
      "order_id":order.to_string(),"buyer_corp_id":buyer.to_string(),
      "owner_id":seller.to_string(),"quantity":quantity,
      "price_cents":price,"fill_phase":phase,
      "source":source,"state":state,"bid":false,"is_corp":false,
      "station_id":station,"region_id":region,"solar_system_id":solar,
      "type_id":ty,"vol_remaining":remaining,
      "history_recorded":history_day.is_some(),
      "history_day":history_day
    })))
}
fn coop_npc_corp_buy_claim_db(path:&Path,key:&str,order_id:i64,buyer:i64,
 seller:i64,quantity:i64)->Result<serde_json::Value>{
    coop_npc_corp_buy_gate(key)?;
    if order_id<=0||buyer<=0||seller<=0||buyer==seller||
       quantity<=0||quantity>50000{
        bail!("NPC corporate market identity invalid");
    }
    let mut db=load_connection(path)?;
    coop_npc_corp_buy_schema(&db)?;
    let tx=db.transaction()?;
    if let Some(prior)=coop_npc_corp_buy_value(&tx,key)?{
        if prior["order_id"]!=order_id.to_string()||
           prior["buyer_corp_id"]!=buyer.to_string()||
           prior["owner_id"]!=seller.to_string()||
           prior["quantity"]!=quantity{
            bail!("NPC corporate claim replay identity conflict");
        }
        tx.commit()?;return Ok(prior);
    }
    let current=tx.query_row(
      "SELECT owner_id,is_corp,bid,source,state,vol_remaining,price
       FROM market_orders WHERE order_id=?1",
      params![order_id],
      |r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,
         r.get::<_,i64>(2)?,r.get::<_,String>(3)?,
         r.get::<_,String>(4)?,r.get::<_,i64>(5)?,
         r.get::<_,f64>(6)?))
    ).optional()?.ok_or_else(||anyhow!("NPC corporate player ask missing"))?;
    let (owner,is_corp,bid,source,state,remaining,price)=current;
    if owner!=seller||is_corp!=0||bid!=0||source!="player"||
       state!="open"||remaining!=quantity{
        bail!("NPC corporate player ask is not fully available");
    }
    if !price.is_finite()||price<=0.0||price>1_000_000.0{
        bail!("NPC corporate player price invalid");
    }
    let cents=(price*100.0).round();
    if cents<=0.0||cents>100_000_000.0{
        bail!("NPC corporate player price cents overflow");
    }
    let at=now_rfc3339();
    let affected=tx.execute(
      "UPDATE market_orders SET state='settling',updated_at=?2,
         last_state_change_at=?2
       WHERE order_id=?1 AND source='player' AND is_corp=0
        AND bid=0 AND state='open' AND vol_remaining=?3",
      params![order_id,at,quantity])?;
    if affected!=1{bail!("NPC corporate market order claim race lost");}
    tx.execute(
      "INSERT INTO coop_npc_corp_buy_claims(
        claim_key,order_id,buyer_corp_id,seller_id,
        quantity,unit_price_cents,phase,created_at)
       VALUES(?1,?2,?3,?4,?5,?6,'claimed',?7)",
      params![key,order_id,buyer,seller,quantity,cents as i64,at])?;
    let claimed=coop_npc_corp_buy_value(&tx,key)?
      .ok_or_else(||anyhow!("NPC corporate claim receipt missing"))?;
    if claimed["state"]!="settling"||claimed["fill_phase"]!="claimed"{
       bail!("NPC corporate Rust order not claimed");
    }
    tx.commit()?;Ok(claimed)
}
// COOP-052: price-history and claim finalize are one Rust SQLite commit.
// Ordinary RecordTrade RPC is intentionally NOT used (it is non-idempotent).
fn coop_npc_corp_buy_record_history(db:&Connection,key:&str,fill:i64,
    order:i64,ty:i64,unit_price_cents:i64,quantity:i64)->Result<()>{
    if fill<=COOP_NPC_CORP_BUY_FILL_BASE||order<=0||ty<=0||
       unit_price_cents<=0||quantity<=0||quantity>50000{
        bail!("NPC corporate market history amount invalid");
    }
    let prior=db.query_row(
      "SELECT claim_key FROM coop_npc_corp_buy_history WHERE claim_key=?1",
      params![key],|r|r.get::<_,String>(0)).optional()?;
    if prior.is_some(){bail!("NPC corporate market history duplicate attempt");}
    let ty=u32::try_from(ty)?;
    let qty=u64::try_from(quantity)?;
    let price=(unit_price_cents as f64)/100.0;
    if !price.is_finite()||price<=0.0{
        bail!("NPC corporate market history unit price invalid");
    }
    let day=current_trade_day();
    let existing=db.query_row(
      "SELECT low_price,high_price,avg_price,volume,order_count
       FROM price_history WHERE type_id=?1 AND day=?2",
      params![ty,day],|r|Ok((r.get::<_,f64>(0)?,r.get::<_,f64>(1)?,
       r.get::<_,f64>(2)?,r.get::<_,u64>(3)?,r.get::<_,u32>(4)?))
    ).optional()?;
    match existing{
      Some((low,high,avg,volume,orders))=>{
        let next_volume=volume.checked_add(qty)
          .ok_or_else(||anyhow!("NPC history volume overflow"))?;
        let next_orders=orders.checked_add(1)
          .ok_or_else(||anyhow!("NPC history order count overflow"))?;
        let weighted=avg*(volume as f64)+price*(qty as f64);
        if !weighted.is_finite()||next_volume==0{
            bail!("NPC corporate market history weighted average invalid");
        }
        db.execute(
          "UPDATE price_history
           SET low_price=?3,high_price=?4,avg_price=?5,
               volume=?6,order_count=?7 WHERE type_id=?1 AND day=?2",
          params![ty,day,low.min(price),high.max(price),
           weighted/(next_volume as f64),next_volume,next_orders])?;
      }
      None=>{
        db.execute(
          "INSERT INTO price_history
           (type_id,day,low_price,high_price,avg_price,volume,order_count)
           VALUES(?1,?2,?3,?3,?3,?4,1)",
          params![ty,day,price,qty])?;
      }
    }
    db.execute(
      "INSERT INTO coop_npc_corp_buy_history
       (claim_key,fill_id,order_id,type_id,price_cents,quantity,history_day,recorded_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
      params![key,fill,order,ty,unit_price_cents,quantity,day,now_rfc3339()])?;
    Ok(())
}
fn coop_npc_corp_buy_finalize_db(path:&Path,key:&str,order_id:i64,
 buyer:i64,fill:i64)->Result<(serde_json::Value,bool)>{
    coop_npc_corp_buy_gate(key)?;
    if order_id<=0||buyer<=0||fill<=COOP_NPC_CORP_BUY_FILL_BASE{
        bail!("NPC corporate finalize identity invalid");
    }
    let mut db=load_connection(path)?;
    coop_npc_corp_buy_schema(&db)?;
    let tx=db.transaction()?;
    let previous=coop_npc_corp_buy_value(&tx,key)?
      .ok_or_else(||anyhow!("NPC corporate finalize receipt missing"))?;
    if previous["order_id"]!=order_id.to_string()||
       previous["buyer_corp_id"]!=buyer.to_string()||
       previous["fill_id"]!=fill.to_string(){
        bail!("NPC corporate finalize claim mismatch");
    }
    if previous["fill_phase"]=="finalized"&&previous["state"]=="filled"{
        if previous["vol_remaining"]!=0{
            bail!("NPC corporate finalized order quantity corrupted");
        }
        if previous["history_recorded"]!=true{
            bail!("NPC corporate finalized claim lacks durable market history");
        }
        tx.commit()?;return Ok((previous,false));
    }
    if previous["fill_phase"]!="claimed"||previous["state"]!="settling"{
        bail!("NPC corporate claim not in settle state");
    }
    let quantity=previous["quantity"].as_i64()
      .ok_or_else(||anyhow!("NPC corporate quantity missing"))?;
    let changed=tx.execute(
      "UPDATE market_orders SET state='filled',vol_remaining=0,
        updated_at=?2,last_state_change_at=?2
       WHERE order_id=?1 AND state='settling' AND source='player'
        AND is_corp=0 AND bid=0 AND vol_remaining=?3",
      params![order_id,now_rfc3339(),quantity])?;
    if changed!=1{bail!("NPC corporate Rust remaining inventory conflict");}
    let ty=previous["type_id"].as_i64()
      .ok_or_else(||anyhow!("NPC corporate type missing"))?;
    let unit_price_cents=previous["price_cents"].as_i64()
      .ok_or_else(||anyhow!("NPC corporate price cents missing"))?;
    coop_npc_corp_buy_record_history(&tx,key,fill,order_id,
      ty,unit_price_cents,quantity)?;
    let changed_fill=tx.execute(
      "UPDATE coop_npc_corp_buy_claims SET phase='finalized'
       WHERE claim_key=?1 AND order_id=?2 AND phase='claimed'",
      params![key,order_id])?;
    if changed_fill!=1{bail!("NPC corporate Rust fill receipt conflict");}
    let result=coop_npc_corp_buy_value(&tx,key)?
      .ok_or_else(||anyhow!("NPC corporate finalized row missing"))?;
    if result["history_recorded"]!=true||
       result["history_day"].as_str().unwrap_or("").is_empty(){
        bail!("NPC corporate finalized without market history receipt");
    }
    tx.commit()?;Ok((result,true))
}
impl MarketRuntime{
    pub async fn coop_npc_corp_buy_claim(&self,key:String,order:i64,
      buyer:i64,seller:i64,quantity:i64)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let result=tokio::task::spawn_blocking(move ||
          coop_npc_corp_buy_claim_db(&path,&key,order,buyer,seller,quantity))
          .await.context("NPC corporate player ask claim worker failed")??;
        let region=u32::try_from(result["region_id"].as_u64().ok_or_else(||anyhow!("region missing"))?)?;
        let solar=u32::try_from(result["solar_system_id"].as_u64().ok_or_else(||anyhow!("solar missing"))?)?;
        let station=result["station_id"].as_u64().ok_or_else(||anyhow!("station missing"))?;
        let ty=u32::try_from(result["type_id"].as_u64().ok_or_else(||anyhow!("type missing"))?)?;
        self.invalidate_scope_caches(region,solar,station,ty).await;
        self.refresh_region_summary_row(region,ty).await?;
        Ok(result)
    }
    pub async fn coop_npc_corp_buy_inspect(&self,key:String)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        tokio::task::spawn_blocking(move ||{
          let db=load_connection(&path)?;
          coop_npc_corp_buy_schema(&db)?;
          coop_npc_corp_buy_gate(&key)?;
          coop_npc_corp_buy_value(&db,&key)?
            .ok_or_else(||anyhow!("NPC corporate player claim missing"))
        }).await.context("NPC corporate player claim read worker failed")?
    }
    pub async fn coop_npc_corp_buy_finalize(&self,key:String,order:i64,
      buyer:i64,fill:i64)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let (result,changed)=tokio::task::spawn_blocking(move ||
          coop_npc_corp_buy_finalize_db(&path,&key,order,buyer,fill))
          .await.context("NPC corporate player ask finalize worker failed")??;
        if changed{
          let region=u32::try_from(result["region_id"].as_u64().ok_or_else(||anyhow!("region missing"))?)?;
          let solar=u32::try_from(result["solar_system_id"].as_u64().ok_or_else(||anyhow!("solar missing"))?)?;
          let station=result["station_id"].as_u64().ok_or_else(||anyhow!("station missing"))?;
          let ty=u32::try_from(result["type_id"].as_u64().ok_or_else(||anyhow!("type missing"))?)?;
          self.invalidate_scope_caches(region,solar,station,ty).await;
          self.refresh_region_summary_row(region,ty).await?;
        }
        Ok(result)
    }
}
