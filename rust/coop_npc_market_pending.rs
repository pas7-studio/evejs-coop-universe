// COOP-034 / pinned EveJS market Rust extension.
// This file is included in state.rs only through the explicit manual patch.
// Rust feature default OFF. Pending reservations are invisible to stock queries.
// No claim of atomicity between the Rust and EveJS GameStore databases.

fn coop_npc_check_operation(op: &str) -> Result<()> {
    if std::env::var("EVEJS_COOP_RUST_NPC_MARKET_PENDING").ok().as_deref() != Some("1") {
        bail!("NPC market pending RPC disabled");
    }
    // Stage J uses the SAME pending-order and claim/finalize protocol.
    // Salvage has an additional independent feature gate and a distinct
    // source operation namespace, never a manufactured item identity.
    let token=if let Some(value)=op.strip_prefix("npc-manufacture:"){
        value
    } else if let Some(value)=op.strip_prefix("npc-salvage:"){
        if std::env::var("EVEJS_COOP_RUST_NPC_SALVAGE_MARKET").ok().as_deref()!=Some("1") {
            bail!("NPC salvage market RPC disabled");
        }
        value
    } else {
        bail!("invalid NPC market source operation");
    };
    if token.len()!=32 || !token.bytes().all(|b|
        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        bail!("invalid NPC market source operation");
    }
    Ok(())
}
fn coop_npc_ensure(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS coop_npc_sell_reservations(
           operation_id TEXT PRIMARY KEY NOT NULL,
           source_item_id INTEGER UNIQUE NOT NULL,
           order_id INTEGER UNIQUE NOT NULL
         );"
    )?;
    Ok(())
}
fn coop_npc_row(db: &Connection, op: &str) -> Result<Option<serde_json::Value>> {
    let record = db.query_row(
        "SELECT r.source_item_id,o.order_id,o.owner_id,o.station_id,o.type_id,
                o.vol_entered,o.price,o.state,o.source,o.bid,o.is_corp,
                o.region_id,o.solar_system_id,o.vol_remaining
           FROM coop_npc_sell_reservations r
           JOIN market_orders o ON o.order_id=r.order_id
          WHERE r.operation_id=?1",
        params![op],
        |row| Ok((
            row.get::<_,i64>(0)?,row.get::<_,i64>(1)?,row.get::<_,i64>(2)?,
            row.get::<_,i64>(3)?,row.get::<_,i64>(4)?,row.get::<_,i64>(5)?,
            row.get::<_,f64>(6)?,row.get::<_,String>(7)?,row.get::<_,String>(8)?,
            row.get::<_,i64>(9)?,row.get::<_,i64>(10)?,row.get::<_,i64>(11)?,
            row.get::<_,i64>(12)?,row.get::<_,i64>(13)?
        ))
    ).optional()?;
    Ok(record.map(|(item,order,owner,station,ty,qty,price,state,source,
        bid,corp,region,solar,remaining)|serde_json::json!({
        "operation_id":op,"source_item_id":item.to_string(),
        "order_id":order.to_string(),"owner_id":owner,"station_id":station,
        "type_id":ty,"quantity":qty,"vol_remaining":remaining,"price":price,"state":state,
        "source":source,"bid":bid!=0,"is_corp":corp!=0,
        "region_id":region,"solar_system_id":solar
    })))
}
fn coop_npc_reserve_db(path: &Path, p: PlaceOrderRequest, op: &str, item: i64)
  -> Result<serde_json::Value> {
    coop_npc_check_operation(op)?;
    if !p.is_corp || p.bid || p.source.as_deref()!=Some("coop-npc") ||
       p.owner_id==0 || p.station_id==0 || p.type_id==0 ||
       item<=0 || p.quantity==0 || p.quantity>50000 ||
       !p.price.is_finite() || p.price<=0.0 || p.price>1000000.0 {
        bail!("invalid NPC pending sell order");
    }
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;
    let st=lookup_station_meta(&db,p.station_id)?;
    let tx=db.transaction()?;
    if let Some(previous)=coop_npc_row(&tx,op)? {
        if previous["source_item_id"] != item.to_string() ||
           previous["owner_id"] != p.owner_id || previous["station_id"] != p.station_id ||
           previous["type_id"] != p.type_id || previous["quantity"] != p.quantity ||
           previous["price"] != p.price || previous["source"] != "coop-npc" ||
           (previous["state"] != "pending" && previous["state"] != "open") {
            bail!("NPC operation ID reused with different order");
        }
        tx.commit()?;
        return Ok(previous);
    }
    let now=now_rfc3339();
    tx.execute(
       "INSERT INTO market_orders(
          owner_id,is_corp,wallet_division,station_id,solar_system_id,constellation_id,
          region_id,type_id,price,vol_entered,vol_remaining,min_volume,bid,
          range_value,duration_days,escrow,state,source,issued_at,last_state_change_at,updated_at
        ) VALUES(
          ?1,1,1000,?2,?3,?4,
          ?5,?6,?7,?8,?8,1,0,
          32767,90,0,'pending','coop-npc',?9,NULL,?9
        )",
       params![p.owner_id,st.station_id,st.solar_system_id,st.constellation_id,
               st.region_id,p.type_id,p.price,p.quantity,now]
    )?;
    let order_id=tx.last_insert_rowid();
    tx.execute("INSERT INTO coop_npc_sell_reservations(operation_id,source_item_id,order_id)
       VALUES (?1,?2,?3)",params![op,item,order_id])?;
    let result=coop_npc_row(&tx,op)?.ok_or_else(||anyhow!("reservation disappeared"))?;
    tx.commit()?;
    Ok(result)
}
fn coop_npc_get_db(path: &Path, op: &str)->Result<serde_json::Value>{
    coop_npc_check_operation(op)?;
    let db=load_connection(path)?;
    coop_npc_ensure(&db)?;
    coop_npc_row(&db,op)?.ok_or_else(||anyhow!("NPC reservation not found"))
}
fn coop_npc_activate_db(path:&Path,op:&str,order_id:i64,item:i64)
 ->Result<(serde_json::Value,bool)> {
    coop_npc_check_operation(op)?;
    // Stock player-buy settlement does not yet transfer corporate ISK or native NPC escrow.
    // Activate must remain blocked until that explicit downstream patch is proven.
    if std::env::var("EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT").ok().as_deref()!=Some("1") {
        bail!("NPC player-buy settlement not activated");
    }
    if item<=0 || order_id<=0 {bail!("invalid NPC activation IDs");}
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;
    let tx=db.transaction()?;
    let previous=coop_npc_row(&tx,op)?
       .ok_or_else(||anyhow!("NPC pending order not found"))?;
    if previous["order_id"]!=order_id.to_string() ||
       previous["source_item_id"]!=item.to_string() ||
       previous["source"]!="coop-npc" || previous["bid"]!=false ||
       previous["is_corp"]!=true {
        bail!("NPC pending order identity mismatch");
    }
    let state=previous["state"].as_str().ok_or_else(||anyhow!("invalid NPC order state"))?;
    if state!="pending" && state!="open" {bail!("NPC order already closed");}
    let changed=state=="pending";
    if changed {
        let affected=tx.execute(
          "UPDATE market_orders SET state='open',last_state_change_at=?2,updated_at=?2
            WHERE order_id=?1 AND state='pending' AND source='coop-npc'",
          params![order_id,now_rfc3339()]
        )?;
        if affected!=1 {bail!("NPC order activation conflict");}
    }
    let result=coop_npc_row(&tx,op)?.ok_or_else(||anyhow!("NPC order disappeared"))?;
    if result["state"]!="open" {bail!("NPC order not active");}
    tx.commit()?;
    Ok((result,changed))
}
impl MarketRuntime {
    pub async fn coop_npc_reserve(&self,p:PlaceOrderRequest,op:String,item:i64)
      ->Result<serde_json::Value>{
        let path=self.database_path.clone();
        tokio::task::spawn_blocking(move ||coop_npc_reserve_db(&path,p,&op,item))
          .await.context("NPC reserve worker task failed")?
    }
    pub async fn coop_npc_get(&self,op:String)->Result<serde_json::Value>{
        let path=self.database_path.clone();
        tokio::task::spawn_blocking(move ||coop_npc_get_db(&path,&op))
          .await.context("NPC inspect worker task failed")?
    }
    pub async fn coop_npc_activate(&self,op:String,order_id:i64,item:i64)
      ->Result<serde_json::Value>{
        let path=self.database_path.clone();
        let (row,changed)=tokio::task::spawn_blocking(move ||
            coop_npc_activate_db(&path,&op,order_id,item)
        ).await.context("NPC activation worker task failed")??;
        if changed {
            let region=u32::try_from(row["region_id"].as_u64().ok_or_else(||anyhow!("invalid NPC region"))?)?;
            let solar=u32::try_from(row["solar_system_id"].as_u64().ok_or_else(||anyhow!("invalid NPC solar"))?)?;
            let station=row["station_id"].as_u64().ok_or_else(||anyhow!("invalid NPC station"))?;
            let ty=u32::try_from(row["type_id"].as_u64().ok_or_else(||anyhow!("invalid NPC type"))?)?;
            self.invalidate_scope_caches(region,solar,station,ty).await;
            self.refresh_region_summary_row(region,ty).await?;
        }
        Ok(row)
    }
}
