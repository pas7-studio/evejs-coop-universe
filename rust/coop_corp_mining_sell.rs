// CH24+31 E2B2 — original Rust market-server corporate SELL preparation.
//
// Included into pinned state.rs by a reversible opt-in Rust patch.
// Orders are PREPARED and invisible to native orderbooks until the original
// GameStore SQLite shows the identical physical corporate escrow item.
// Publication is intentionally blocked until corporate buyer debit / seller
// credit / partial-fill claim support exists in the native market settlement.
// No free ore, ISK, character owner substitution, or synthetic buyer.

fn coop_corp_sell_guard(token:&str)->Result<()>{
    if std::env::var("EVEJS_COOP_RUST_CORP_SELL_PREPARE").ok().as_deref()!=Some("1"){
        bail!("CORP_SELL_RUST_PREPARE_DISABLED");
    }
    let secret=std::env::var("EVEJS_COOP_RUST_CORP_SELL_TOKEN")
        .context("CORP_SELL_SERVER_TOKEN_MISSING")?;
    if secret.len()<32||secret.len()>256||token.len()!=secret.len(){
        bail!("CORP_SELL_SERVER_TOKEN_DENIED");
    }
    let diff=secret.bytes().zip(token.bytes()).fold(0_u8,|acc,(a,b)|acc|(a^b));
    if diff!=0 { bail!("CORP_SELL_SERVER_TOKEN_DENIED");}
    Ok(())
}
fn coop_corp_sell_op(op:&str,shift:&str)->Result<()>{
    if op.len()!=47 || !op.starts_with("coop-corp-sell:")||
       !op[15..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)){
        bail!("CORP_SELL_OPERATION_INVALID");
    }
    if shift.len()!=50||!shift.starts_with("coop-mining-shift:")||
       !shift[18..].bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        bail!("CORP_SELL_SHIFT_INVALID");
    }
    Ok(())
}
fn coop_corp_sell_schema(db:&Connection)->Result<()>{
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS coop_corp_sell_prepared(
          operation_id TEXT PRIMARY KEY NOT NULL,
          shift_id TEXT NOT NULL,
          cargo_id INTEGER UNIQUE NOT NULL,
          item_id INTEGER UNIQUE NOT NULL,
          order_id INTEGER UNIQUE NOT NULL,
          owner_id INTEGER NOT NULL,
          station_id INTEGER NOT NULL,
          type_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          price_cents INTEGER NOT NULL,
          phase TEXT NOT NULL CHECK (phase IN ('prepared','published','cancelled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );"
    )?;
    Ok(())
}
fn coop_corp_sell_row(db:&Connection,op:&str)->Result<Option<serde_json::Value>>{
    let row=db.query_row(
        "SELECT r.shift_id,r.cargo_id,r.item_id,r.order_id,r.owner_id,
                r.station_id,r.type_id,r.quantity,r.price_cents,r.phase,
                o.state,o.source,o.is_corp,o.bid,o.vol_remaining,
                o.vol_entered,o.price
         FROM coop_corp_sell_prepared r
         JOIN market_orders o ON o.order_id=r.order_id
         WHERE r.operation_id=?1",
        params![op],|r|Ok((
            r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
            r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,i64>(5)?,
            r.get::<_,i64>(6)?,r.get::<_,i64>(7)?,r.get::<_,i64>(8)?,
            r.get::<_,String>(9)?,r.get::<_,String>(10)?,r.get::<_,String>(11)?,
            r.get::<_,i64>(12)?,r.get::<_,i64>(13)?,r.get::<_,i64>(14)?,
            r.get::<_,i64>(15)?,r.get::<_,f64>(16)?
        ))
    ).optional()?;
    Ok(row.map(|(shift,cargo,item,order,owner,station,ty,qty,price_cents,
                    phase,state,source,corp,bid,remaining,entered,price)|{
        serde_json::json!({
            "verifiedNative":true,
            "phase":if phase=="prepared"{"PREPARED_UNPUBLISHED"}
                    else if phase=="published"{"OPEN"}else{"CANCELLED"},
            "isPublished":phase=="published",
            "totalFilled":0,"totalPaidCents":0,
            "operationID":op,"shiftID":shift,
            "cargoID":cargo,"itemID":item,"orderID":order.to_string(),
            "order":{
                "order_id":order.to_string(),"owner_id":owner,
                "is_corp":corp==1,"bid":bid!=0,"station_id":station,
                "type_id":ty,"vol_remaining":remaining,"vol_entered":entered,
                "source":source,"price_cents":price_cents,
                "price":price,"state":state
            }
        })
    }))
}
// Original GameStore native sqlite tables are key TEXT PRIMARY KEY,
// json TEXT NOT NULL. Read-only; NEVER mutate Node-owned SQLite here.
fn coop_corp_sell_gamestore()->Result<Connection>{
    let name=std::env::var("EVEJS_COOP_RUST_CORP_SELL_GAMESTORE_DB")
        .context("CORP_SELL_GAMESTORE_PATH_MISSING")?;
    let path=Path::new(&name);
    if !path.is_absolute()||!path.is_file(){bail!("CORP_SELL_GAMESTORE_PATH_INVALID");}
    let flags=rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
       |rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let db=Connection::open_with_flags(path,flags)?;
    db.busy_timeout(std::time::Duration::from_millis(1000))?;
    Ok(db)
}
fn coop_corp_sell_json(db:&Connection,table:&str,key:&str)->Result<serde_json::Value>{
    if !["items","marketEscrow","corporationRuntime","characters"].contains(&table){
        bail!("CORP_SELL_GAMESTORE_TABLE_DENIED");
    }
    let sql=format!("SELECT json FROM \"{}\" WHERE key=?1",table);
    let json:String=db.query_row(&sql,params![key],|r|r.get(0))
        .context("CORP_SELL_GAMESTORE_RECEIPT_NOT_FOUND")?;
    let value:serde_json::Value=serde_json::from_str(&json)?;
    Ok(value)
}
fn coop_corp_sell_verify_escrow(db:&Connection,op:&str)->Result<serde_json::Value>{
    let r=coop_corp_sell_row(db,op)?
        .ok_or_else(||anyhow!("CORP_SELL_PREPARE_NOT_FOUND"))?;
    if r["phase"]!="PREPARED_UNPUBLISHED"||
       r["order"]["state"]!="prepared"||
       r["order"]["is_corp"]!=true||r["order"]["bid"]!=false||
       r["order"]["source"]!="coop-corporation"{
        bail!("CORP_SELL_PREPARED_ORDER_NOT_PRIVATE");
    }
    let cargo=r["cargoID"].as_i64().ok_or_else(||anyhow!("CORP_SELL_CARGO_INVALID"))?;
    let item=r["itemID"].as_i64().ok_or_else(||anyhow!("CORP_SELL_ITEM_INVALID"))?;
    let owner=r["order"]["owner_id"].as_i64()
        .ok_or_else(||anyhow!("CORP_SELL_OWNER_INVALID"))?;
    let order=r["orderID"].as_str()
        .ok_or_else(||anyhow!("CORP_SELL_ORDER_INVALID"))?;
    let order_i: i64=order.parse()?;
    let location=9_200_000_000_i64.checked_add(order_i)
       .ok_or_else(||anyhow!("CORP_SELL_ESCROW_LOCATION_OVERFLOW"))?;
    if location>9_007_199_254_740_991_i64 {
        bail!("CORP_SELL_ESCROW_LOCATION_NOT_JS_SAFE");
    }
    let origin=coop_corp_sell_gamestore()?;
    let receipt=coop_corp_sell_json(&origin,"corporationRuntime",
        &format!("coopPlayerMiningCorpSell\u{001f}{}",cargo))?;
    let physical=coop_corp_sell_json(&origin,"items",&item.to_string())?;
    let escrow=coop_corp_sell_json(&origin,"marketEscrow",order)?;
    if receipt["version"]!=1||receipt["phase"]!="ESCROW_BOUND_UNSETTLED"||
       receipt["operationID"]!=r["shiftID"]||
       receipt["cargoID"]!=cargo||receipt["itemID"]!=item||
       receipt["typeID"]!=r["order"]["type_id"]||
       receipt["quantity"]!=r["order"]["vol_entered"]||
       receipt["corporationID"]!=owner||receipt["orderID"]!=order||
       receipt["stationID"]!=r["order"]["station_id"]||
       receipt["escrowLocationID"]!=location||
       physical["itemID"]!=item||physical["ownerID"]!=owner||
       physical["typeID"]!=r["order"]["type_id"]||
       physical["quantity"]!=r["order"]["vol_entered"]||
       physical["stacksize"]!=r["order"]["vol_entered"]||
       physical["singleton"]!=0||physical["flagID"]!=4||
       physical["locationID"]!=location||
       physical["customInfo"]!=format!("coop-warehouse:v1:cargo:{}",cargo)||
       escrow["orderId"]!=order||escrow["isCorp"]!=true||
       escrow["ownerId"]!=owner||escrow["escrowType"]!="sell"||
       escrow["escrowLocationID"]!=location||
       escrow["remainingQuantity"]!=r["order"]["vol_entered"]||
       escrow["phase"]!="ESCROW_BOUND_UNSETTLED"||
       escrow["sourceItemIDs"]!=serde_json::json!([item]){
        bail!("CORP_SELL_ORIGINAL_GAMESTORE_CUSTODY_NOT_COMMITTED");
    }
    // All original ownership and physical escrow identities agree.
    Ok(serde_json::json!({
      "status":"ESCROW_PROVEN_NOT_PUBLISHED","orderID":order,
      "itemID":item,"cargoID":cargo,"corporationID":owner,
      "nativeMarketMutation":false,"verifiedGameStore":true
    }))
}
fn coop_corp_sell_prepare_db(path:&Path,token:&str,op:&str,shift:&str,
    cargo:i64,item:i64,owner:i64,station:i64,ty:i64,qty:i64,price_cents:i64)
    ->Result<serde_json::Value>{
    coop_corp_sell_guard(token)?;
    coop_corp_sell_op(op,shift)?;
    if cargo<=0||item<=0||owner<=0||station<=0||ty<=0||
       qty<=0||qty>50000||price_cents<=0||price_cents>100_000_000{
        bail!("CORP_SELL_INVALID_ORIGINAL_ORDER_SCOPE");
    }
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    let station_meta=lookup_station_meta(&db,station as u64)?;
    let tx=db.transaction()?;
    if let Some(existing)=coop_corp_sell_row(&tx,op)?{
        if existing["shiftID"]!=shift||existing["cargoID"]!=cargo||
           existing["itemID"]!=item||existing["order"]["owner_id"]!=owner||
           existing["order"]["station_id"]!=station||
           existing["order"]["type_id"]!=ty||
           existing["order"]["vol_entered"]!=qty||
           existing["order"]["price_cents"]!=price_cents||
           !["PREPARED_UNPUBLISHED","OPEN"].contains(&existing["phase"].as_str().unwrap_or("")){
            bail!("CORP_SELL_PREPARE_REPLAY_CONFLICT");
        }
        tx.commit()?;return Ok(existing);
    }
    let now=now_rfc3339();
    tx.execute(
      "INSERT INTO market_orders(
        owner_id,is_corp,wallet_division,station_id,solar_system_id,constellation_id,
        region_id,type_id,price,vol_entered,vol_remaining,min_volume,bid,
        range_value,duration_days,escrow,state,source,issued_at,last_state_change_at,updated_at
       ) VALUES (
        ?1,1,1000,?2,?3,?4,
        ?5,?6,?7,?8,?8,1,0,
        32767,90,0,'prepared','coop-corporation',?9,NULL,?9
       )",
      params![owner,station_meta.station_id,station_meta.solar_system_id,
              station_meta.constellation_id,station_meta.region_id,ty,
              price_cents as f64/100.0,qty,now]
    )?;
    let order_id=tx.last_insert_rowid();
    tx.execute(
      "INSERT INTO coop_corp_sell_prepared
       (operation_id,shift_id,cargo_id,item_id,order_id,owner_id,
        station_id,type_id,quantity,price_cents,phase,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'prepared',?11,?11)",
      params![op,shift,cargo,item,order_id,owner,station,ty,qty,price_cents,now]
    )?;
    let result=coop_corp_sell_row(&tx,op)?
      .ok_or_else(||anyhow!("CORP_SELL_PREPARE_DISAPPEARED"))?;
    tx.commit()?;
    Ok(result)
}
fn coop_corp_sell_inspect_db(path:&Path,token:&str,op:&str)
  ->Result<serde_json::Value>{
    coop_corp_sell_guard(token)?;
    let db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    coop_corp_sell_row(&db,op)?
      .ok_or_else(||anyhow!("CORP_SELL_PREPARE_NOT_FOUND"))
}
fn coop_corp_sell_verify_db(path:&Path,token:&str,op:&str)
  ->Result<serde_json::Value>{
    coop_corp_sell_guard(token)?;
    let db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    coop_corp_sell_verify_escrow(&db,op)
}
fn coop_corp_sell_publish_db(path:&Path,token:&str,op:&str)
  ->Result<serde_json::Value>{
    coop_corp_sell_guard(token)?;
    let db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    let evidence=coop_corp_sell_verify_escrow(&db,op)?;
    // DO NOT expose this order to stock FillOrder; original pinned
    // market + P2P settlement only know character-owned or NPC-backed
    // trades. A prepared corporate SELL cannot be consumed yet.
    bail!("CORP_SELL_NATIVE_FILL_SETTLEMENT_NOT_IMPLEMENTED: {:?}",evidence)
}
impl MarketRuntime{
    pub async fn coop_corp_sell_prepare(&self,token:String,op:String,shift:String,
       cargo:i64,item:i64,owner:i64,station:i64,ty:i64,qty:i64,price_cents:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_sell_prepare_db(
         &path,&token,&op,&shift,cargo,item,owner,station,ty,qty,price_cents))
         .await.context("corporate sell prepare failed")?
    }
    pub async fn coop_corp_sell_get(&self,token:String,op:String)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_sell_inspect_db(&path,&token,&op))
         .await.context("corporate sell get failed")?
    }
    pub async fn coop_corp_sell_verify(&self,token:String,op:String)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_sell_verify_db(&path,&token,&op))
         .await.context("corporate sell escrow verify failed")?
    }
    pub async fn coop_corp_sell_publish(&self,token:String,op:String)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_sell_publish_db(&path,&token,&op))
         .await.context("corporate sell publish failed")?
    }
}

// CH24+31 E2B3: source-authenticated original Rust corporate partial fill
// claim. This does NOT settle wallets, finalize market volume or publish.
// A single order may have only one in-flight claimed cycle. Publishing
// remains blocked above until independent GameStore settlement is verified.
fn coop_corp_fill_gate(token:&str)->Result<()>{
    coop_corp_sell_guard(token)?;
    if std::env::var("EVEJS_COOP_RUST_CORP_FILL_CLAIM").ok().as_deref()!=Some("1"){
        bail!("CORP_FILL_RUST_CLAIM_DISABLED");
    }
    Ok(())
}
fn coop_corp_fill_schema(db:&Connection)->Result<()>{
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS coop_corp_sell_fills(
           order_id INTEGER NOT NULL,
           cycle INTEGER NOT NULL,
           buyer_id INTEGER NOT NULL,
           volume_before INTEGER NOT NULL,
           filled_quantity INTEGER NOT NULL,
           volume_after INTEGER NOT NULL,
           price_cents INTEGER NOT NULL,
           phase TEXT NOT NULL CHECK(phase IN ('claimed','finalized','released')),
           created_at TEXT NOT NULL,
           ack_json TEXT,
           native_receipt_key TEXT,
           PRIMARY KEY(order_id,cycle)
         );
         CREATE UNIQUE INDEX IF NOT EXISTS coop_corp_sell_active_claim
         ON coop_corp_sell_fills(order_id) WHERE phase='claimed';"
    )?;
    Ok(())
}
fn coop_corp_fill_read(db:&Connection,order:i64,cycle:i64)->Result<serde_json::Value>{
    let row=db.query_row(
       "SELECT f.buyer_id,f.volume_before,f.filled_quantity,f.volume_after,
               f.price_cents,f.phase,p.cargo_id,p.item_id,p.owner_id,
               p.station_id,p.type_id,r.source,r.is_corp,r.bid,r.state,
               r.vol_remaining
        FROM coop_corp_sell_fills f
        JOIN coop_corp_sell_prepared p ON p.order_id=f.order_id
        JOIN market_orders r ON r.order_id=f.order_id
        WHERE f.order_id=?1 AND f.cycle=?2",
       params![order,cycle],
       |r| Ok((
         r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
         r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,
         r.get::<_,i64>(6)?,r.get::<_,i64>(7)?,r.get::<_,i64>(8)?,
         r.get::<_,i64>(9)?,r.get::<_,i64>(10)?,r.get::<_,String>(11)?,
         r.get::<_,i64>(12)?,r.get::<_,i64>(13)?,r.get::<_,String>(14)?,
         r.get::<_,i64>(15)?
       ))
    ).optional()?.ok_or_else(||anyhow!("CORP_FILL_NATIVE_CLAIM_MISSING"))?;
    let (buyer,before,qty,after,price,phase,cargo,item,owner,station,ty,
         source,corp,bid,state,remaining)=row;
    if remaining!=before || source!="coop-corporation"||corp!=1||
       bid!=0||state!="settling"||phase!="claimed"{
        bail!("CORP_FILL_NATIVE_CLAIM_NO_LONGER_LOCKED");
    }
    let location=9_200_000_000_i64.checked_add(order)
       .ok_or_else(||anyhow!("CORP_FILL_ESCROW_LOCATION_OVERFLOW"))?;
    if location>9_007_199_254_740_991_i64 {
        bail!("CORP_FILL_ESCROW_LOCATION_NOT_SAFE");
    }
    Ok(serde_json::json!({
      "verifiedNative":true,"phase":"claimed","state":"settling",
      "source":"coop-corporation","is_corp":true,"bid":false,
      "orderID":order.to_string(),"cycle":cycle,
      "buyerCharacterID":buyer,"sellerCorpID":owner,
      "stationID":station,"typeID":ty,"cargoID":cargo,
      "sourceItemID":item,"priceCents":price,
      "volumeBefore":before,"quantity":qty,"volumeAfter":after,
      "escrowLocationID":location
    }))
}
fn coop_corp_fill_claim_db(path:&Path,token:&str,order:i64,cycle:i64,
     buyer:i64,volume_before:i64,quantity:i64,price_cents:i64)
     ->Result<serde_json::Value>{
    coop_corp_fill_gate(token)?;
    if order<=0||cycle<=0||buyer<=0||volume_before<=0||
      quantity<=0||quantity>volume_before||price_cents<=0||
      order>9_007_199_254_740_991_i64-9_200_000_000_i64 {
        bail!("CORP_FILL_IDENTITY_OR_VOLUME_INVALID");
    }
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    coop_corp_fill_schema(&db)?;
    let tx=db.transaction()?;
    let prior=tx.query_row(
      "SELECT buyer_id,volume_before,filled_quantity,price_cents,phase
       FROM coop_corp_sell_fills WHERE order_id=?1 AND cycle=?2",
      params![order,cycle],
      |r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
              r.get::<_,i64>(3)?,r.get::<_,String>(4)?))
    ).optional()?;
    if let Some((previous_buyer,previous_before,previous_qty,previous_price,phase))=prior {
        if (previous_buyer,previous_before,previous_qty,previous_price)!=(buyer,
            volume_before,quantity,price_cents)||phase!="claimed"{
            bail!("CORP_FILL_CLAIM_REPLAY_CONFLICT");
        }
        let witness=coop_corp_fill_read(&tx,order,cycle)?;
        tx.commit()?;
        return Ok(witness);
    }
    let order_row=tx.query_row(
      "SELECT p.phase,p.owner_id,p.item_id,p.station_id,p.type_id,
              r.state,r.source,r.is_corp,r.bid,r.vol_remaining,r.price
       FROM coop_corp_sell_prepared p
       JOIN market_orders r ON r.order_id=p.order_id
       WHERE p.order_id=?1",
       params![order],
       |r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
          r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,
          r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,i64>(8)?,
          r.get::<_,i64>(9)?,r.get::<_,f64>(10)?))
    ).optional()?.ok_or_else(||anyhow!("CORP_FILL_ORDER_NOT_FOUND"))?;
    let (publish_phase,seller,item,station,ty,state,source,is_corp,bid,remaining,price)=order_row;
    let native_cents=price*100.0;
    if publish_phase!="published"||state!="open"||
       source!="coop-corporation"||is_corp!=1||bid!=0||
       seller<=0||item<=0||station<=0||ty<=0||seller==buyer||
       remaining!=volume_before||!native_cents.is_finite()||
       (native_cents.round()-native_cents).abs()>0.000001||
       native_cents.round() as i64!=price_cents {
        bail!("CORP_FILL_UNBACKED_OR_UNPUBLISHED_ORDER");
    }
    let previous:Option<i64>=tx.query_row(
      "SELECT MAX(cycle) FROM coop_corp_sell_fills WHERE order_id=?1",
      params![order],|r|r.get(0)
    )?;
    if cycle!=previous.unwrap_or(0).checked_add(1)
       .ok_or_else(||anyhow!("CORP_FILL_CYCLE_OVERFLOW"))?{
        bail!("CORP_FILL_CYCLE_NOT_NEXT");
    }
    let changed=tx.execute(
      "UPDATE market_orders SET state='settling',updated_at=?2
       WHERE order_id=?1 AND state='open' AND source='coop-corporation'
         AND is_corp=1 AND bid=0 AND vol_remaining=?3",
      params![order,now_rfc3339(),volume_before]
    )?;
    if changed!=1{bail!("CORP_FILL_EXCLUSIVE_LOCK_FAILED");}
    tx.execute(
      "INSERT INTO coop_corp_sell_fills(order_id,cycle,buyer_id,
         volume_before,filled_quantity,volume_after,price_cents,phase,created_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,'claimed',?8)",
      params![order,cycle,buyer,volume_before,quantity,
       volume_before-quantity,price_cents,now_rfc3339()]
    )?;
    let witness=coop_corp_fill_read(&tx,order,cycle)?;
    tx.commit()?;
    Ok(witness)
}
fn coop_corp_fill_inspect_db(path:&Path,token:&str,order:i64,cycle:i64)
  ->Result<serde_json::Value>{
    coop_corp_fill_gate(token)?;
    if order<=0||cycle<=0{bail!("CORP_FILL_QUERY_INVALID");}
    let db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;
    coop_corp_fill_schema(&db)?;
    let state=db.query_row(
      "SELECT phase,ack_json,native_receipt_key FROM coop_corp_sell_fills
       WHERE order_id=?1 AND cycle=?2",
      params![order,cycle],
      |r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,
              r.get::<_,Option<String>>(2)?))
    ).optional()?.ok_or_else(||anyhow!("CORP_FILL_GET_CLAIM_NOT_FOUND"))?;
    if state.0=="claimed"{return coop_corp_fill_read(&db,order,cycle);}
    if !["finalized","released"].contains(&state.0.as_str()){
        bail!("CORP_FILL_GET_UNEXPECTED_PHASE");
    }
    let receipt=state.2.ok_or_else(||anyhow!("CORP_FILL_GET_RECEIPT_NOT_PERSISTED"))?;
    let ack:serde_json::Value=serde_json::from_str(
      state.1.as_deref().ok_or_else(||anyhow!("CORP_FILL_GET_ACK_NOT_PERSISTED"))?)?;
    if ack["phase"]!=state.0||ack["receiptKey"]!=receipt||
       ack["orderID"]!=order.to_string()||ack["cycle"]!=cycle{
        bail!("CORP_FILL_GET_PERSISTED_ACK_MISMATCH");
    }
    Ok(serde_json::json!({
      "orderID":order.to_string(),"cycle":cycle,"phase":state.0,
      "nativeReceiptKey":receipt,"ack":ack,"verifiedNative":true,
      "readOnly":true
    }))
}
impl MarketRuntime{
    pub async fn coop_corp_fill_claim(&self,token:String,order:i64,cycle:i64,
       buyer:i64,before:i64,quantity:i64,price_cents:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_fill_claim_db(
         &path,&token,order,cycle,buyer,before,quantity,price_cents))
         .await.context("corporate Rust fill claim failed")?
    }
    pub async fn coop_corp_fill_get(&self,token:String,order:i64,cycle:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||coop_corp_fill_inspect_db(
         &path,&token,order,cycle))
         .await.context("corporate Rust fill get failed")?
    }
}


// CH24+31 E2B4 — independently witness original GameStore paid corpus
// BEFORE Rust finalizes or releases a claim. Invariant: every buyer debit,
// corporation wallet credit, exact fee, physical item and escrow quantity
// must be proven from fsynced native SQLite in one read snapshot.
fn coop_corp_fill_signed_cents(value:&serde_json::Value)->Result<i64>{
    let n=value.as_f64().ok_or_else(||anyhow!("CORP_FILL_JOURNAL_AMOUNT_INVALID"))?;
    let scaled=n*100.0;
    if !scaled.is_finite() || (scaled.round()-scaled).abs()>0.000001 ||
       scaled.abs()>9_007_199_254_740_991.0 {
        bail!("CORP_FILL_JOURNAL_AMOUNT_UNSAFE");
    }
    Ok(scaled.round() as i64)
}
fn coop_corp_fill_journal<'a>(
  entries:&'a serde_json::Value,id:i64,key:&str
)->Result<&'a serde_json::Value>{
    let list=entries.as_array().ok_or_else(||anyhow!("CORP_FILL_WALLET_JOURNAL_NOT_ARRAY"))?;
    let matches:Vec<_>=list.iter().filter(|row|row["transactionID"]==id).collect();
    if matches.len()!=1 {bail!("CORP_FILL_WALLET_JOURNAL_ID_MISSING_OR_DUPLICATED: {}",key);}
    Ok(matches[0])
}
fn coop_corp_fill_audit(original:&Connection,proof:&serde_json::Value)
  ->Result<String>{
    let order=proof["orderID"].as_str().ok_or_else(||anyhow!("CORP_FILL_ORDER_ID_MISSING"))?;
    let cycle=proof["cycle"].as_i64().ok_or_else(||anyhow!("CORP_FILL_CYCLE_MISSING"))?;
    let buyer=proof["buyerCharacterID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_BUYER_MISSING"))?;
    let seller=proof["sellerCorpID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_SELLER_MISSING"))?;
    let source_item=proof["sourceItemID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_SOURCE_ITEM_MISSING"))?;
    let cargo=proof["cargoID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_CARGO_MISSING"))?;
    let qty=proof["quantity"].as_i64().ok_or_else(||anyhow!("CORP_FILL_QUANTITY_MISSING"))?;
    let before=proof["volumeBefore"].as_i64().ok_or_else(||anyhow!("CORP_FILL_BEFORE_MISSING"))?;
    let after=proof["volumeAfter"].as_i64().ok_or_else(||anyhow!("CORP_FILL_AFTER_MISSING"))?;
    let price=proof["priceCents"].as_i64().ok_or_else(||anyhow!("CORP_FILL_PRICE_MISSING"))?;
    let station=proof["stationID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_STATION_MISSING"))?;
    let ty=proof["typeID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_TYPE_MISSING"))?;
    let location=proof["escrowLocationID"].as_i64().ok_or_else(||anyhow!("CORP_FILL_LOCATION_MISSING"))?;
    if order.parse::<i64>()? <= 0||cycle<=0||qty<=0||before<=0||
      qty>before||before-qty!=after||buyer<=0||seller<=0||
      buyer==seller||price<=0||cargo<=0||source_item<=0{
       bail!("CORP_FILL_SOURCE_PROOF_INVALID");
    }
    let key=format!("coopPlayerMiningCorpFill\u{001f}{}:{}",order,cycle);
    let result=coop_corp_sell_json(original,"corporationRuntime",&key)?;
    let corp=coop_corp_sell_json(original,"corporationRuntime",
      &format!("corporations\u{001f}{}",seller))?;
    let person=coop_corp_sell_json(original,"characters",&buyer.to_string())?;
    let escrow=coop_corp_sell_json(original,"marketEscrow",order)?;
    let origin=coop_corp_sell_json(original,"corporationRuntime",
      &format!("coopPlayerMiningCorpSell\u{001f}{}",cargo))?;
    let destination=result["deliveredItemID"].as_i64()
        .ok_or_else(||anyhow!("CORP_FILL_DELIVERED_ITEM_NOT_RECORDED"))?;
    let physical=coop_corp_sell_json(original,"items",&destination.to_string())?;
    let original_item=if after>0 {
        Some(coop_corp_sell_json(original,"items",&source_item.to_string())?)
    }else{None};
    let gross=price.checked_mul(qty).ok_or_else(||anyhow!("CORP_FILL_GROSS_OVERFLOW"))?;
    let tax=result["transactionTaxCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_TAX_MISSING"))?;
    let broker=result["brokerFeeCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_BROKER_MISSING"))?;
    let total=tax.checked_add(broker).ok_or_else(||anyhow!("CORP_FILL_FEE_OVERFLOW"))?;
    let net=gross.checked_sub(total).ok_or_else(||anyhow!("CORP_FILL_NET_OVERFLOW"))?;
    let buyer_before=result["buyerBeforeCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_BUYER_BEFORE_MISSING"))?;
    let buyer_after=result["buyerAfterCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_BUYER_AFTER_MISSING"))?;
    let seller_before=result["sellerBeforeCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_SELLER_BEFORE_MISSING"))?;
    let seller_after=result["sellerAfterCents"].as_i64()
      .ok_or_else(||anyhow!("CORP_FILL_SELLER_AFTER_MISSING"))?;
    if tax<0||broker<0||total>gross||buyer_before<gross||
       buyer_before-gross!=buyer_after||
       seller_before.checked_add(net)!=Some(seller_after)||
       result["version"]!=1||result["phase"]!="GAMESTORE_COMMITTED"||
       result["receiptKey"]!=key||result["orderID"]!=order||
       result["cycle"]!=cycle||result["buyerCharacterID"]!=buyer||
       result["sellerCorpID"]!=seller||result["cargoID"]!=cargo||
       result["sourceItemID"]!=source_item||result["deliveredItemID"]!=destination||
       result["quantity"]!=qty||result["volumeBefore"]!=before||
       result["volumeAfter"]!=after||result["priceCents"]!=price||
       result["stationID"]!=station||result["typeID"]!=ty||
       result["grossCents"]!=gross||result["netRevenueCents"]!=net||
       result["committedAt"].as_i64().unwrap_or(0)<=0 ||
       corp["corporationID"]!=seller||
       origin["orderID"]!=order||origin["itemID"]!=source_item||
       origin["cargoID"]!=cargo||origin["corporationID"]!=seller||
       origin["remainingQuantity"]!=after||origin["lastSettledCycle"]!=cycle||
       escrow["orderId"]!=order||escrow["isCorp"]!=true||
       escrow["ownerId"]!=seller||escrow["escrowType"]!="sell"||
       escrow["remainingQuantity"]!=after||escrow["escrowLocationID"]!=location||
       escrow["lastSettledCycle"]!=cycle||
       physical["itemID"]!=destination||physical["ownerID"]!=buyer||
       physical["locationID"]!=station||physical["flagID"]!=4||
       physical["typeID"]!=ty||physical["quantity"]!=qty||
       physical["stacksize"]!=qty||physical["singleton"]!=0||
       physical["sourceCargoID"]!=cargo||physical["sourceItemID"]!=source_item||
       physical["customInfo"]!=format!("coop-corp-sale:v1:{}:{}",order,cycle){
        bail!("CORP_FILL_GAMESTORE_ORIGINAL_CUSTODY_OR_PAYMENT_MISMATCH");
    }
    if after>0 {
        let remainder=original_item.as_ref().ok_or_else(||anyhow!("CORP_FILL_REMAINDER_MISSING"))?;
        if destination==source_item||remainder["itemID"]!=source_item||
          remainder["ownerID"]!=seller||remainder["locationID"]!=location||
          remainder["flagID"]!=4||remainder["quantity"]!=after||
          remainder["stacksize"]!=after||remainder["typeID"]!=ty||
          remainder["customInfo"]!=format!("coop-warehouse:v1:cargo:{}",cargo)||
          origin["phase"]!="ACTIVE_SELL"||escrow["phase"]!="ACTIVE_SELL"{
            bail!("CORP_FILL_PARTIAL_ORIGINAL_REMAINDER_NOT_PRESERVED");
        }
    }else if destination!=source_item||origin["phase"]!="FULLY_SOLD"||
        escrow["phase"]!="FULLY_SOLD"{
        bail!("CORP_FILL_COMPLETE_ORIGINAL_ITEM_NOT_TRANSFERRED");
    }
    let buyer_wallet_id=result["buyerJournalID"].as_i64()
        .ok_or_else(||anyhow!("CORP_FILL_BUYER_JOURNAL_ID_NOT_PERSISTED"))?;
    let seller_wallet_id=result["sellerJournalID"].as_i64()
        .ok_or_else(||anyhow!("CORP_FILL_SELLER_JOURNAL_ID_NOT_PERSISTED"))?;
    let buyer_entry=coop_corp_fill_journal(&person["walletJournal"],buyer_wallet_id,"buyer")?;
    let wallet=&corp["wallet"]["divisions"]["1000"];
    let seller_entry=coop_corp_fill_journal(&wallet["journal"],seller_wallet_id,"seller")?;
    let seller_txn=coop_corp_fill_journal(&wallet["transactions"],seller_wallet_id,"seller transaction")?;
    if buyer_entry["referenceID"]!=key||buyer_entry["ownerID1"]!=buyer||
       buyer_entry["ownerID2"]!=seller||buyer_entry["balance"].as_f64()
           .map(|v|(v*100.0-buyer_after as f64).abs()>0.000001)!=Some(false)||
       coop_corp_fill_signed_cents(&buyer_entry["amount"])?!=-gross||
       seller_entry["referenceID"]!=key||seller_entry["ownerID1"]!=buyer||
       seller_entry["ownerID2"]!=seller||
       coop_corp_fill_signed_cents(&seller_entry["amount"])?!=gross||
       coop_corp_fill_signed_cents(&seller_txn["amount"])?!=gross||
       seller_txn["referenceID"]!=key {
        bail!("CORP_FILL_ORIGINAL_WALLET_DEBIT_CREDIT_NOT_FOUND");
    }
    if total>0 {
        let fee_id=result["feeJournalID"].as_i64()
          .ok_or_else(||anyhow!("CORP_FILL_FEE_JOURNAL_ID_NOT_PERSISTED"))?;
        let fee_entry=coop_corp_fill_journal(&wallet["journal"],fee_id,"fee")?;
        let fee_txn=coop_corp_fill_journal(&wallet["transactions"],fee_id,"fee transaction")?;
        if fee_entry["referenceID"]!=key||fee_txn["referenceID"]!=key||
           coop_corp_fill_signed_cents(&fee_entry["amount"])?!=-total||
           coop_corp_fill_signed_cents(&fee_txn["amount"])?!=-total ||
           fee_entry["balance"].as_f64()
             .map(|v|(v*100.0-seller_after as f64).abs()>0.000001)!=Some(false){
            bail!("CORP_FILL_ORIGINAL_MARKET_FEES_NOT_DEBITED");
        }
    }else if !result["feeJournalID"].is_null(){
        bail!("CORP_FILL_ZERO_FEE_HAS_UNEXPECTED_DEBIT");
    }
    Ok(key)
}
// Durable original GameStore receipt is independently inspected by Rust,
// not accepted as a boolean from Node or an untrusted game client.
fn coop_corp_fill_game_store_witness(proof:&serde_json::Value)->Result<String>{
    let original=coop_corp_sell_gamestore()?;
    original.execute_batch("BEGIN DEFERRED TRANSACTION")?;
    coop_corp_fill_audit(&original,proof)
}
fn coop_corp_fill_finalize_db(path:&Path,token:&str,order:i64,cycle:i64)
 ->Result<serde_json::Value>{
    coop_corp_fill_gate(token)?;
    if order<=0||cycle<=0{bail!("CORP_FILL_FINALIZE_SCOPE_INVALID");}
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;coop_corp_fill_schema(&db)?;
    let tx=db.transaction()?;
    let row=tx.query_row(
       "SELECT phase,ack_json,native_receipt_key,volume_before,volume_after,
              filled_quantity,price_cents
        FROM coop_corp_sell_fills WHERE order_id=?1 AND cycle=?2",
       params![order,cycle],
       |r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,
         r.get::<_,Option<String>>(2)?,r.get::<_,i64>(3)?,
         r.get::<_,i64>(4)?,r.get::<_,i64>(5)?,r.get::<_,i64>(6)?))
    ).optional()?.ok_or_else(||anyhow!("CORP_FILL_FINALIZE_CLAIM_MISSING"))?;
    let (phase,ack,key,before,after,qty,price)=row;
    if phase=="finalized"||phase=="released"{
        let ack=ack.ok_or_else(||anyhow!("CORP_FILL_FINALIZED_ACK_MISSING"))?;
        let response:serde_json::Value=serde_json::from_str(&ack)?;
        if key.as_deref()!=Some(format!("coopPlayerMiningCorpFill\u{001f}{}:{}",order,cycle).as_str()){
            bail!("CORP_FILL_FINALIZED_RECEIPT_KEY_INVALID");
        }
        tx.commit()?;return Ok(response);
    }
    if phase!="claimed"||ack.is_some()||key.is_some(){
        bail!("CORP_FILL_FINALIZE_PHASE_INVALID");
    }
    let witness=coop_corp_fill_read(&tx,order,cycle)?;
    if witness["volumeBefore"]!=before||witness["volumeAfter"]!=after||
       witness["quantity"]!=qty||witness["priceCents"]!=price{
        bail!("CORP_FILL_FINALIZE_RUST_CLAIM_CHANGED");
    }
    let receipt_key=coop_corp_fill_game_store_witness(&witness)?;
    let n=tx.execute(
       "UPDATE market_orders SET vol_remaining=?3,updated_at=?4
        WHERE order_id=?1 AND source='coop-corporation' AND is_corp=1
          AND bid=0 AND state='settling' AND vol_remaining=?2",
       params![order,before,after,now_rfc3339()]
    )?;
    if n!=1{bail!("CORP_FILL_FINALIZE_ORDER_CAS_FAILED");}
    let result=serde_json::json!({
      "orderID":order.to_string(),"cycle":cycle,
      "phase":"finalized","state":"settling",
      "volumeAfter":after,"filledQuantity":qty,
      "receiptKey":receipt_key,"verifiedGameStore":true,
      "claimProof":witness,"requiresRelease":true
    });
    let n=tx.execute(
       "UPDATE coop_corp_sell_fills
        SET phase='finalized',ack_json=?3,native_receipt_key=?4
        WHERE order_id=?1 AND cycle=?2 AND phase='claimed'",
       params![order,cycle,result.to_string(),receipt_key]
    )?;
    if n!=1{bail!("CORP_FILL_FINALIZE_RECEIPT_CAS_FAILED");}
    tx.commit()?;
    Ok(result)
}
fn coop_corp_fill_release_db(path:&Path,token:&str,order:i64,cycle:i64)
 ->Result<serde_json::Value>{
    coop_corp_fill_gate(token)?;
    if order<=0||cycle<=0{bail!("CORP_FILL_RELEASE_SCOPE_INVALID");}
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;coop_corp_fill_schema(&db)?;
    let tx=db.transaction()?;
    let row=tx.query_row(
       "SELECT phase,ack_json,native_receipt_key,volume_after
        FROM coop_corp_sell_fills WHERE order_id=?1 AND cycle=?2",
       params![order,cycle],
       |r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,
         r.get::<_,Option<String>>(2)?,r.get::<_,i64>(3)?))
    ).optional()?.ok_or_else(||anyhow!("CORP_FILL_RELEASE_CLAIM_MISSING"))?;
    let (phase,ack,key,after)=row;
    if phase=="released"{
        let stored=ack.ok_or_else(||anyhow!("CORP_FILL_RELEASE_ACK_MISSING"))?;
        let value:serde_json::Value=serde_json::from_str(&stored)?;
        tx.commit()?;return Ok(value);
    }
    if phase!="finalized"||key.is_none(){
        bail!("CORP_FILL_RELEASE_REQUIRES_FINALIZED_PAYMENT");
    }
    let stored=ack.ok_or_else(||anyhow!("CORP_FILL_FINALIZE_ACK_MISSING"))?;
    let v:serde_json::Value=serde_json::from_str(&stored)?;
    if v["verifiedGameStore"]!=true||v["receiptKey"]!=key.as_deref().unwrap_or("")||
       v["phase"]!="finalized"{
        bail!("CORP_FILL_RELEASE_INVALID_FINALIZED_WITNESS");
    }
    // A repeated independent read must still confirm exact original
    // GameStore buyer, corporate seller, market escrow and ISK journal.
    let original=coop_corp_sell_gamestore()?;
    original.execute_batch("BEGIN DEFERRED TRANSACTION")?;
    let claim_proof=&v["claimProof"];
    if claim_proof["verifiedNative"]!=true||
       claim_proof["orderID"]!=order.to_string()||
       claim_proof["cycle"]!=cycle||
       claim_proof["volumeAfter"]!=after||
       coop_corp_fill_audit(&original,claim_proof)?!=key.as_deref().unwrap_or(""){
        bail!("CORP_FILL_RELEASE_DURABLE_PAYMENT_NO_LONGER_VERIFIED");
    }
    let state=if after==0{"filled"}else{"open"};
    let n=tx.execute(
       "UPDATE market_orders SET state=?3,updated_at=?4,
         last_state_change_at=?4
        WHERE order_id=?1 AND vol_remaining=?2 AND
          state='settling' AND is_corp=1 AND source='coop-corporation'",
       params![order,after,state,now_rfc3339()]
    )?;
    if n!=1{bail!("CORP_FILL_RELEASE_EXCLUSIVE_LOCK_LOST");}
    let result=serde_json::json!({
      "orderID":order.to_string(),"cycle":cycle,"phase":"released",
      "state":state,"volumeAfter":after,"receiptKey":key,
      "verifiedGameStore":true,"invalidated":true
    });
    let n=tx.execute(
       "UPDATE coop_corp_sell_fills
        SET phase='released',ack_json=?3
        WHERE order_id=?1 AND cycle=?2 AND phase='finalized'",
       params![order,cycle,result.to_string()]
    )?;
    if n!=1{bail!("CORP_FILL_RELEASE_RECEIPT_CAS_FAILED");}
    tx.commit()?;Ok(result)
}
impl MarketRuntime{
    pub async fn coop_corp_fill_finalize(&self,token:String,order:i64,cycle:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       let result=tokio::task::spawn_blocking(move||
          coop_corp_fill_finalize_db(&path,&token,order,cycle))
          .await.context("corporate fill finalize failed")??;
       let row=self.get_order(order).await?;
       self.invalidate_scope_caches(row.row.region_id,
         row.row.solar_system_id,row.row.station_id,row.row.type_id).await;
       self.refresh_region_summary_row(row.row.region_id,row.row.type_id).await?;
       Ok(result)
    }
    pub async fn coop_corp_fill_release(&self,token:String,order:i64,cycle:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       let result=tokio::task::spawn_blocking(move||
          coop_corp_fill_release_db(&path,&token,order,cycle))
          .await.context("corporate fill release failed")??;
       let row=self.get_order(order).await?;
       self.invalidate_scope_caches(row.row.region_id,
         row.row.solar_system_id,row.row.station_id,row.row.type_id).await;
       self.refresh_region_summary_row(row.row.region_id,row.row.type_id).await?;
       Ok(result)
    }
}


// CH24+31 E2B5: exclusive ORIGINAL Rust partial-unsold cancellation.
// Lock original Rust order FIRST. No stock CancelOrder, FillOrder or
// external buyer action may consume the same physical corporate stock.
// The GameStore returns only the verified UNSOLD remaining units to the
// original corporate office; then Rust independently reads that COMMIT.
fn coop_corp_cancel_gate(token:&str)->Result<()>{
    coop_corp_sell_guard(token)?;
    if std::env::var("EVEJS_COOP_RUST_CORP_CANCEL").ok().as_deref()!=Some("1"){
        bail!("CORP_SELL_RUST_CANCEL_DISABLED");
    }
    Ok(())
}
fn coop_corp_cancel_schema(db:&Connection)->Result<()>{
    db.execute_batch(
      "CREATE TABLE IF NOT EXISTS coop_corp_sell_cancel_intents(
        order_id INTEGER PRIMARY KEY NOT NULL,
        owner_id INTEGER NOT NULL,
        cargo_id INTEGER NOT NULL,
        source_item_id INTEGER NOT NULL,
        remaining_quantity INTEGER NOT NULL,
        settled_cycles INTEGER NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('locked','cancelled')),
        ack_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );"
    )?;Ok(())
}
fn coop_corp_cancel_read(db:&Connection,order:i64)->Result<serde_json::Value>{
    let v=db.query_row(
      "SELECT c.owner_id,c.cargo_id,c.source_item_id,c.remaining_quantity,
              c.settled_cycles,c.phase,c.ack_json,
              p.station_id,p.type_id,p.shift_id,r.state,r.source,r.is_corp,
              r.vol_remaining,r.bid
       FROM coop_corp_sell_cancel_intents c
       JOIN coop_corp_sell_prepared p ON p.order_id=c.order_id
       JOIN market_orders r ON r.order_id=c.order_id
       WHERE c.order_id=?1",
      params![order],
      |r|Ok((
        r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
        r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,
        r.get::<_,Option<String>>(6)?,r.get::<_,i64>(7)?,
        r.get::<_,i64>(8)?,r.get::<_,String>(9)?,
        r.get::<_,String>(10)?,r.get::<_,String>(11)?,
        r.get::<_,i64>(12)?,r.get::<_,i64>(13)?,
        r.get::<_,i64>(14)?
      ))
    ).optional()?.ok_or_else(||anyhow!("CORP_CANCEL_INTENT_NOT_FOUND"))?;
    let (owner,cargo,item,remaining,cycles,phase,ack,station,ty,shift,
         state,source,corp,order_remaining,bid)=v;
    if source!="coop-corporation"||corp!=1||bid!=0||
       order_remaining!=remaining||
       (phase=="locked"&&state!="cancelling")||
       (phase=="cancelled"&&state!="cancelled"){
      bail!("CORP_CANCEL_LOCK_ORIGINAL_ORDER_MISMATCH");
    }
    Ok(serde_json::json!({
      "verifiedNative":true,"phase":if phase=="locked"{"CANCEL_LOCKED"}
                                   else{"CANCELLED"},
      "orderID":order.to_string(),"corporationID":owner,
      "cargoID":cargo,"sourceItemID":item,
      "stationID":station,"typeID":ty,"shiftID":shift,
      "remainingQuantity":remaining,"settledCycles":cycles,
      "cancelled":phase=="cancelled",
      "ack":ack.and_then(|v|serde_json::from_str::<serde_json::Value>(&v).ok())
    }))
}
fn coop_corp_cancel_lock_db(path:&Path,token:&str,order:i64)->Result<serde_json::Value>{
    coop_corp_cancel_gate(token)?;
    if order<=0||order>9_007_199_254_740_991_i64-9_200_000_000_i64{
      bail!("CORP_CANCEL_INVALID_ORDER");
    }
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;coop_corp_fill_schema(&db)?;
    coop_corp_cancel_schema(&db)?;
    let tx=db.transaction()?;
    let old:Option<i64>=tx.query_row(
      "SELECT order_id FROM coop_corp_sell_cancel_intents WHERE order_id=?1",
      params![order],|r|r.get(0)
    ).optional()?;
    if old.is_some(){
      let v=coop_corp_cancel_read(&tx,order)?;
      tx.commit()?;return Ok(v);
    }
    let source=tx.query_row(
      "SELECT p.owner_id,p.cargo_id,p.item_id,p.phase,
              r.state,r.source,r.is_corp,r.bid,r.vol_remaining
       FROM coop_corp_sell_prepared p JOIN market_orders r
         ON r.order_id=p.order_id WHERE p.order_id=?1",
      params![order],
      |r|Ok((
         r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,
         r.get::<_,i64>(2)?,r.get::<_,String>(3)?,
         r.get::<_,String>(4)?,r.get::<_,String>(5)?,
         r.get::<_,i64>(6)?,r.get::<_,i64>(7)?,
         r.get::<_,i64>(8)?
      ))
    ).optional()?.ok_or_else(||anyhow!("CORP_CANCEL_SOURCE_ORDER_NOT_FOUND"))?;
    let (owner,cargo,item,phase,state,src,corp,bid,remaining)=source;
    if owner<=0||cargo<=0||item<=0||remaining<=0||
       src!="coop-corporation"||corp!=1||bid!=0||
       !((phase=="prepared"&&state=="prepared")||
         (phase=="published"&&state=="open")){
       bail!("CORP_CANCEL_NOT_ELIGIBLE_OR_ALREADY_LOCKED");
    }
    let active:i64=tx.query_row(
      "SELECT COUNT(*) FROM coop_corp_sell_fills
       WHERE order_id=?1 AND phase!='released'",
      params![order],|r|r.get(0)
    )?;
    if active!=0{bail!("CORP_CANCEL_UNSETTLED_OR_ACTIVE_FILL");}
    let cycles:i64=tx.query_row(
      "SELECT COALESCE(MAX(cycle),0) FROM coop_corp_sell_fills
       WHERE order_id=?1 AND phase='released'",
      params![order],|r|r.get(0)
    )?;
    let total:i64=tx.query_row(
      "SELECT COUNT(*) FROM coop_corp_sell_fills WHERE order_id=?1",
      params![order],|r|r.get(0)
    )?;
    if cycles!=total{bail!("CORP_CANCEL_NONCONTIGUOUS_FILLS");}
    let now=now_rfc3339();
    let n=tx.execute(
      "UPDATE market_orders SET state='cancelling',
        last_state_change_at=?2,updated_at=?2
       WHERE order_id=?1 AND state=?3 AND source='coop-corporation'
         AND is_corp=1 AND bid=0 AND vol_remaining=?4",
      params![order,now,state,remaining]
    )?;
    if n!=1{bail!("CORP_CANCEL_EXCLUSIVE_ORDER_LOCK_FAILED");}
    tx.execute(
      "INSERT INTO coop_corp_sell_cancel_intents
       (order_id,owner_id,cargo_id,source_item_id,
        remaining_quantity,settled_cycles,phase,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,'locked',?7,?7)",
      params![order,owner,cargo,item,remaining,cycles,now]
    )?;
    let v=coop_corp_cancel_read(&tx,order)?;
    tx.commit()?;Ok(v)
}
fn coop_corp_cancel_verify_return(
   origin:&Connection,witness:&serde_json::Value)->Result<serde_json::Value>{
    let order=witness["orderID"].as_str()
      .ok_or_else(||anyhow!("CORP_CANCEL_ORDER_MISSING"))?;
    let cargo=witness["cargoID"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_CARGO_MISSING"))?;
    let item=witness["sourceItemID"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_ITEM_MISSING"))?;
    let owner=witness["corporationID"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_OWNER_MISSING"))?;
    let qty=witness["remainingQuantity"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_QUANTITY_MISSING"))?;
    let cycles=witness["settledCycles"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_CYCLE_MISSING"))?;
    let station=witness["stationID"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_STATION_MISSING"))?;
    let ty=witness["typeID"].as_i64()
      .ok_or_else(||anyhow!("CORP_CANCEL_TYPE_MISSING"))?;
    if qty<=0||cycles<0||owner<=0||item<=0||cargo<=0{bail!("CORP_CANCEL_SCOPE_BAD");}
    let receipt=coop_corp_sell_json(origin,"corporationRuntime",
      &format!("coopPlayerMiningCorpSell\u{001f}{}",cargo))?;
    let escrow=coop_corp_sell_json(origin,"marketEscrow",order)?;
    let physical=coop_corp_sell_json(origin,"items",&item.to_string())?;
    if receipt["version"]!=1||receipt["phase"]!="RETURNED_UNSOLD"||
       receipt["orderID"]!=order||receipt["cargoID"]!=cargo||
       receipt["corporationID"]!=owner||receipt["itemID"]!=item||
       receipt["stationID"]!=station||receipt["typeID"]!=ty||
       receipt["returnedQuantity"]!=qty||
       receipt["remainingQuantity"]!=0||
       receipt["lastSettledCycle"]!=cycles||
       receipt["returnedAt"].as_i64().unwrap_or(0)<=0||
       escrow["orderId"]!=order||escrow["isCorp"]!=true||
       escrow["ownerId"]!=owner||escrow["phase"]!="RETURNED_UNSOLD"||
       escrow["remainingQuantity"]!=0||
       escrow["sourceItemIDs"]!=serde_json::json!([item])||
       physical["itemID"]!=item||physical["ownerID"]!=owner||
       physical["typeID"]!=ty||physical["quantity"]!=qty||
       physical["stacksize"]!=qty||physical["singleton"]!=0||
       physical["locationID"]!=receipt["originalLocationID"]||
       physical["flagID"]!=receipt["originalFlagID"]||
       physical["customInfo"]!=format!("coop-warehouse:v1:cargo:{}",cargo){
        bail!("CORP_CANCEL_ORIGINAL_UNSOLD_ITEM_NOT_RETURNED");
    }
    Ok(serde_json::json!({
      "orderID":order,"phase":"CANCELLED","verifiedGameStore":true,
      "remainingReturned":qty,"settledCycles":cycles,
      "sourceItemID":item,"corporationID":owner
    }))
}
fn coop_corp_cancel_finalize_db(path:&Path,token:&str,order:i64)->Result<serde_json::Value>{
    coop_corp_cancel_gate(token)?;
    let mut db=load_connection(path)?;
    coop_corp_sell_schema(&db)?;coop_corp_fill_schema(&db)?;
    coop_corp_cancel_schema(&db)?;
    let tx=db.transaction()?;
    let v=coop_corp_cancel_read(&tx,order)?;
    if v["phase"]=="CANCELLED"{
       let ack=v["ack"].clone();
       if ack["phase"]!="CANCELLED"||ack["verifiedGameStore"]!=true{
          bail!("CORP_CANCEL_FINALIZED_ACK_MISSING");
       }
       tx.commit()?;return Ok(ack);
    }
    if v["phase"]!="CANCEL_LOCKED"{bail!("CORP_CANCEL_NOT_LOCKED");}
    let original=coop_corp_sell_gamestore()?;
    original.execute_batch("BEGIN DEFERRED TRANSACTION")?;
    let proof=coop_corp_cancel_verify_return(&original,&v)?;
    let now=now_rfc3339();
    let n=tx.execute(
      "UPDATE market_orders SET state='cancelled',
       last_state_change_at=?2,updated_at=?2 WHERE order_id=?1
       AND state='cancelling' AND source='coop-corporation'
       AND is_corp=1 AND vol_remaining=?3",
      params![order,now,v["remainingQuantity"].as_i64().unwrap_or(-1)]
    )?;
    if n!=1{bail!("CORP_CANCEL_ORDER_CAS_FAILED");}
    let n=tx.execute(
      "UPDATE coop_corp_sell_prepared SET phase='cancelled',updated_at=?2
       WHERE order_id=?1 AND phase IN ('prepared','published')",
      params![order,now]
    )?;
    if n!=1{bail!("CORP_CANCEL_PREPARED_CAS_FAILED");}
    let n=tx.execute(
      "UPDATE coop_corp_sell_cancel_intents SET phase='cancelled',
        ack_json=?2,updated_at=?3 WHERE order_id=?1 AND phase='locked'",
      params![order,proof.to_string(),now]
    )?;
    if n!=1{bail!("CORP_CANCEL_INTENT_CAS_FAILED");}
    tx.commit()?;Ok(proof)
}
impl MarketRuntime {
    pub async fn coop_corp_cancel_lock(&self,token:String,order:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       let result=tokio::task::spawn_blocking(move||
         coop_corp_cancel_lock_db(&path,&token,order))
         .await.context("corporate unsold cancellation lock failed")??;
       let row=self.get_order(order).await?;
       self.invalidate_scope_caches(row.row.region_id,
          row.row.solar_system_id,row.row.station_id,row.row.type_id).await;
       self.refresh_region_summary_row(row.row.region_id,row.row.type_id).await?;
       Ok(result)
    }
    pub async fn coop_corp_cancel_get(&self,token:String,order:i64)
       ->Result<serde_json::Value>{
       coop_corp_cancel_gate(&token)?;
       let path=self.database_path.clone();
       tokio::task::spawn_blocking(move||{
          let db=load_connection(&path)?;
          coop_corp_cancel_schema(&db)?;
          coop_corp_cancel_read(&db,order)
       }).await.context("corporate unsold cancellation inspect failed")?
    }
    pub async fn coop_corp_cancel_finalize(&self,token:String,order:i64)
       ->Result<serde_json::Value>{
       let path=self.database_path.clone();
       let result=tokio::task::spawn_blocking(move||
          coop_corp_cancel_finalize_db(&path,&token,order))
          .await.context("corporate unsold cancellation finalize failed")??;
       let row=self.get_order(order).await?;
       self.invalidate_scope_caches(row.row.region_id,
          row.row.solar_system_id,row.row.station_id,row.row.type_id).await;
       self.refresh_region_summary_row(row.row.region_id,row.row.type_id).await?;
       Ok(result)
    }
}

// CH24+31 E2B6: independently grounded ORIGINAL corporate buyer quote.
// No matching, reservation, order publication or wallet write.
fn coop_corp_buyer_quote_db(path:&Path,token:&str,order:i64,buyer:i64,
 qty:i64,max_price:i64)->Result<serde_json::Value>{
 coop_corp_sell_guard(token)?;
 if std::env::var("EVEJS_COOP_RUST_CORP_BUYER_QUOTE").ok().as_deref()!=Some("1"){
  bail!("CORP_BUYER_QUOTE_DISABLED");
 }
 if order<=0||buyer<=0||qty<=0||max_price<=0||
 order>9_007_199_254_740_991_i64-9_200_000_000_i64{
  bail!("CORP_BUYER_QUOTE_INVALID");
 }
 let db=load_connection(path)?;
 coop_corp_sell_schema(&db)?;
 let record=db.query_row(
 "SELECT p.operation_id,p.cargo_id,p.item_id,p.owner_id,
  p.station_id,p.type_id,p.price_cents,p.phase,m.state,m.source,
  m.is_corp,m.bid,m.vol_remaining
  FROM coop_corp_sell_prepared p JOIN market_orders m
  ON p.order_id=m.order_id WHERE p.order_id=?1",
 params![order],|r|Ok((
  r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,
  r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,i64>(5)?,
  r.get::<_,i64>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?,
  r.get::<_,String>(9)?,r.get::<_,i64>(10)?,r.get::<_,i64>(11)?,
  r.get::<_,i64>(12)?
 ))).optional()?.ok_or_else(||anyhow!("CORP_BUYER_ORDER_MISSING"))?;
 let (op,cargo,item,seller,station,ty,price,phase,state,source,corp,bid,left)=record;
 if phase!="published"||state!="open"||source!="coop-corporation"||
 corp!=1||bid!=0||seller<=0||buyer==seller||price<=0||
 qty>left||left<=0||price>max_price{
  bail!("CORP_BUYER_ORDER_UNAVAILABLE");
 }
 let gross=price.checked_mul(qty).ok_or_else(||anyhow!("CORP_BUYER_PRICE_OVERFLOW"))?;
 if gross>9_007_199_254_740_991_i64{bail!("CORP_BUYER_PRICE_UNSAFE");}
 let gs=coop_corp_sell_gamestore()?;
 gs.execute_batch("BEGIN DEFERRED TRANSACTION")?;
 let person=coop_corp_sell_json(&gs,"characters",&buyer.to_string())?;
 let wallet=coop_corp_fill_signed_cents(&person["balance"])?;
 if person["characterID"]!=buyer||wallet<gross{
  bail!("CORP_BUYER_REAL_FUNDS_MISSING");
 }
 let sale=coop_corp_sell_json(&gs,"corporationRuntime",
  &format!("coopPlayerMiningCorpSell\u{001f}{}",cargo))?;
 let escrow=coop_corp_sell_json(&gs,"marketEscrow",&order.to_string())?;
 let physical=coop_corp_sell_json(&gs,"items",&item.to_string())?;
 let location=order+9_200_000_000_i64;
 if sale["orderID"]!=order.to_string()||sale["corporationID"]!=seller||
 sale["itemID"]!=item||sale["cargoID"]!=cargo||
 (sale["remainingQuantity"].as_i64().unwrap_or(left))!=left||
 escrow["remainingQuantity"]!=left||escrow["ownerId"]!=seller||
 escrow["isCorp"]!=true||escrow["sourceItemIDs"]!=serde_json::json!([item])||
 physical["ownerID"]!=seller||physical["itemID"]!=item||
 physical["locationID"]!=location||physical["quantity"]!=left||
 physical["customInfo"]!=format!("coop-warehouse:v1:cargo:{}",cargo){
  bail!("CORP_BUYER_ESCROW_OR_TITLE_DRIFT");
 }
 Ok(serde_json::json!({
  "verifiedNative":true,"status":"ELIGIBLE_NOT_RESERVED",
  "operationID":op,"orderID":order.to_string(),
  "buyerCharacterID":buyer,"sellerCorpID":seller,
  "cargoID":cargo,"sourceItemID":item,"stationID":station,
  "typeID":ty,"priceCents":price,"volumeBefore":left,
  "quantity":qty,"grossCents":gross,"buyerWalletCentsAtQuote":wallet,
  "source":"coop-corporation","is_corp":true,"bid":false,
  "nativeMutation":false,"buyerFundsReserved":false
 }))
}
impl MarketRuntime{
 pub async fn coop_corp_buyer_quote(&self,token:String,order:i64,
 buyer:i64,qty:i64,max_price:i64)->Result<serde_json::Value>{
  let path=self.database_path.clone();
  tokio::task::spawn_blocking(move||
   coop_corp_buyer_quote_db(&path,&token,order,buyer,qty,max_price))
   .await.context("corporate buyer quote failed")?
 }
}
