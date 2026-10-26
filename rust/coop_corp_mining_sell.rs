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
    if !["items","marketEscrow","corporationRuntime"].contains(&table){
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