// COOP-035 Rust whole-stack NPC corp settlement claim/finalize.
// Manual reversible extension only. Never callable unless both exact flags ON.
// Requires prior COOP-034 include in the same market-server state.rs.
const COOP_NPC_FILL_ID_BASE:i64=900_000_000_000_000;

fn coop_npc_fill_schema(db:&Connection)->Result<()>{
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS coop_npc_sell_fills(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER UNIQUE NOT NULL,
            buyer_id INTEGER NOT NULL,
            phase TEXT NOT NULL DEFAULT 'claimed',
            created_at TEXT NOT NULL
        );"
    )?;
    Ok(())
}
fn coop_npc_fill_gate(op:&str)->Result<()>{
    coop_npc_check_operation(op)?;
    if std::env::var("EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT").ok().as_deref()!=Some("1") {
        bail!("NPC native corporate buyer settlement is disabled");
    }
    Ok(())
}
fn coop_npc_fill_value(db:&Connection,op:&str)->Result<Option<serde_json::Value>>{
    let row=coop_npc_row(db,op)?;
    let Some(mut row)=row else{return Ok(None)};
    let order_id=row["order_id"].as_str()
       .ok_or_else(||anyhow!("invalid NPC market order ID"))?.parse::<i64>()?;
    let claim=db.query_row(
       "SELECT id,buyer_id,phase FROM coop_npc_sell_fills WHERE order_id=?1",
       params![order_id],
       |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))
    ).optional()?;
    if let Some((id,buyer_id,phase))=claim{
        let fill_id=COOP_NPC_FILL_ID_BASE.checked_add(id)
           .ok_or_else(||anyhow!("NPC market fill ID overflow"))?;
        row["fill_id"]=serde_json::json!(fill_id.to_string());
        row["buyer_id"]=serde_json::json!(buyer_id.to_string());
        row["fill_phase"]=serde_json::json!(phase);
    }
    let price=row["price"].as_f64().ok_or_else(||anyhow!("NPC price invalid"))?;
    if !price.is_finite() || price<=0.0 || price>1_000_000.0{
        bail!("NPC price invalid");
    }
    let price_cents=(price*100.0).round();
    if price_cents<=0.0 || price_cents>100_000_000.0{
        bail!("NPC price precision invalid");
    }
    row["price_cents"]=serde_json::json!(price_cents as i64);
    Ok(Some(row))
}
fn coop_npc_claim_db(path:&Path,op:&str,order_id:i64,buyer_id:i64)
 ->Result<serde_json::Value>{
    coop_npc_fill_gate(op)?;
    if order_id<=0 || buyer_id<=0 {bail!("invalid NPC market buyer/order ID");}
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;coop_npc_fill_schema(&db)?;
    let tx=db.transaction()?;
    let current=coop_npc_fill_value(&tx,op)?
        .ok_or_else(||anyhow!("NPC market reservation not found"))?;
    if current["order_id"]!=order_id.to_string() ||
       current["source"]!="coop-npc" || current["is_corp"]!=true ||
       current["bid"]!=false {bail!("NPC market source and order mismatch");}
    let state=current["state"].as_str().ok_or_else(||anyhow!("NPC state invalid"))?;
    if state=="settling"||state=="filled"{
        if current["buyer_id"]!=buyer_id.to_string() ||
            current["fill_phase"].is_null() {bail!("NPC order already claimed by another buyer");}
        tx.commit()?;
        return Ok(current);
    }
    if state!="open" {bail!("NPC order is not sellable");}
    let row_count=tx.execute(
      "UPDATE market_orders SET state='settling',updated_at=?2,
             last_state_change_at=?2
       WHERE order_id=?1 AND state='open' AND source='coop-npc' AND bid=0",
      params![order_id,now_rfc3339()]
    )?;
    if row_count!=1 {bail!("NPC market order lock not acquired");}
    tx.execute(
      "INSERT INTO coop_npc_sell_fills(order_id,buyer_id,phase,created_at)
       VALUES(?1,?2,'claimed',?3)",
      params![order_id,buyer_id,now_rfc3339()]
    )?;
    let claimed=coop_npc_fill_value(&tx,op)?
       .ok_or_else(||anyhow!("NPC claim disappeared"))?;
    if claimed["state"]!="settling" {bail!("NPC order not settled-locked");}
    tx.commit()?;
    Ok(claimed)
}
fn coop_npc_finalize_db(path:&Path,op:&str,order_id:i64,buyer_id:i64,fill_id:i64)
 ->Result<(serde_json::Value,bool)>{
    coop_npc_fill_gate(op)?;
    if order_id<=0||buyer_id<=0||fill_id<COOP_NPC_FILL_ID_BASE{
        bail!("NPC market finalize identity invalid");
    }
    let mut db=load_connection(path)?;
    coop_npc_ensure(&db)?;coop_npc_fill_schema(&db)?;
    let tx=db.transaction()?;
    let current=coop_npc_fill_value(&tx,op)?
      .ok_or_else(||anyhow!("NPC market settlement not found"))?;
    if current["order_id"]!=order_id.to_string() ||
       current["buyer_id"]!=buyer_id.to_string() ||
       current["fill_id"]!=fill_id.to_string()||
       current["source"]!="coop-npc"{
       bail!("NPC market settlement identity mismatch");
    }
    if current["state"]=="filled" && current["fill_phase"]=="filled"{
        tx.commit()?;return Ok((current,false));
    }
    if current["state"]!="settling"||current["fill_phase"]!="claimed"{
        bail!("NPC market settlement not claimed");
    }
    let changed=tx.execute(
      "UPDATE market_orders SET state='filled',vol_remaining=0,updated_at=?2,
          last_state_change_at=?2
       WHERE order_id=?1 AND state='settling' AND source='coop-npc'
         AND vol_remaining=vol_entered",
      params![order_id,now_rfc3339()]
    )?;
    if changed!=1{bail!("NPC market full-stack finalization rejected");}
    let changed_fill=tx.execute(
      "UPDATE coop_npc_sell_fills SET phase='filled' WHERE order_id=?1 AND phase='claimed'",
      params![order_id]
    )?;
    if changed_fill!=1{bail!("NPC market fill receipt not finalized");}
    let done=coop_npc_fill_value(&tx,op)?
      .ok_or_else(||anyhow!("NPC market finalization vanished"))?;
    tx.commit()?;
    Ok((done,true))
}
impl MarketRuntime{
    pub async fn coop_npc_claim_sell(&self,op:String,order_id:i64,buyer_id:i64)
      ->Result<serde_json::Value>{
      let path=self.database_path.clone();
      let row=tokio::task::spawn_blocking(move ||
         coop_npc_claim_db(&path,&op,order_id,buyer_id))
         .await.context("NPC market claim worker failed")??;
      let region=u32::try_from(row["region_id"].as_u64().ok_or_else(||anyhow!("missing region"))?)?;
      let solar=u32::try_from(row["solar_system_id"].as_u64().ok_or_else(||anyhow!("missing solar"))?)?;
      let station=row["station_id"].as_u64().ok_or_else(||anyhow!("missing station"))?;
      let ty=u32::try_from(row["type_id"].as_u64().ok_or_else(||anyhow!("missing type"))?)?;
      self.invalidate_scope_caches(region,solar,station,ty).await;
      self.refresh_region_summary_row(region,ty).await?;
      Ok(row)
    }
    pub async fn coop_npc_get_claim(&self,op:String)->Result<serde_json::Value>{
      let path=self.database_path.clone();
      tokio::task::spawn_blocking(move ||{
          let db=load_connection(&path)?;
          coop_npc_ensure(&db)?;coop_npc_fill_schema(&db)?;
          coop_npc_fill_gate(&op)?;
          coop_npc_fill_value(&db,&op)?.ok_or_else(||anyhow!("NPC sale claim not found"))
      }).await.context("NPC market read claim worker failed")?
    }
    pub async fn coop_npc_finalize_sell(&self,op:String,order_id:i64,buyer_id:i64,fill_id:i64)
      ->Result<serde_json::Value>{
      let path=self.database_path.clone();
      let (row,changed)=tokio::task::spawn_blocking(move ||
         coop_npc_finalize_db(&path,&op,order_id,buyer_id,fill_id))
         .await.context("NPC market finalize worker failed")??;
      if changed{
         let region=u32::try_from(row["region_id"].as_u64().ok_or_else(||anyhow!("missing region"))?)?;
         let solar=u32::try_from(row["solar_system_id"].as_u64().ok_or_else(||anyhow!("missing solar"))?)?;
         let station=row["station_id"].as_u64().ok_or_else(||anyhow!("missing station"))?;
         let ty=u32::try_from(row["type_id"].as_u64().ok_or_else(||anyhow!("missing type"))?)?;
         self.invalidate_scope_caches(region,solar,station,ty).await;
         self.refresh_region_summary_row(region,ty).await?;
      }
      Ok(row)
    }
}
