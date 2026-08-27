require('dotenv').config();
const {Pool}=require('pg');
(async()=>{
 const db=new Pool({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DB,user:process.env.PG_USER,password:process.env.PG_PASSWORD});
 const nq=await db.query(`SELECT status::text, detail FROM integration_health
   WHERE service='news_quality' AND checked_at > $1::timestamptz ORDER BY checked_at DESC LIMIT 1`,[process.env.SINCE_TS]);
 if(nq.rowCount){
  console.log('QUALITY PASS COMPLETED ('+nq.rows[0].status+'):');
  console.log('  coverage: '+nq.rows[0].detail);
  const inc=await db.query(`SELECT signature, detail FROM incidents
    WHERE detected_at > $1::timestamptz AND signature LIKE 'doctor:%'`,[process.env.SINCE_TS]);
  console.log('  doctor incidents: '+inc.rowCount);
  inc.rows.forEach(x=>console.log('    '+x.signature+'  '+x.detail.slice(0,90)));
 }
 await db.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
