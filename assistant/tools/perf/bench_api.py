# Gentle read-only latency check on the demo account (no model calls).
# usage: python bench_api.py http://localhost:8000 <requests per endpoint> <concurrency>
import httpx, time, statistics, sys, json, concurrent.futures as cf
base=sys.argv[1]; n=int(sys.argv[2]); conc=int(sys.argv[3])
paths=["/api/home","/api/dashboard","/api/lists","/api/review","/api/curator","/api/settings","/api/powers","/api/quest/game","/api/quest/profile","/api/quest/receipts","/api/storemap","/api/stores/mine","/api/prices/insights","/api/quest/plan","/api/quest/news","/auth/me","/health"]
c=httpx.Client(base_url=base,timeout=30)
r=c.post("/auth/demo"); ck=dict(c.cookies)
def hit(p):
    cl=httpx.Client(base_url=base,cookies=ck,timeout=30)
    t=time.perf_counter(); r=cl.get(p,headers={"Accept-Encoding":"gzip"}); return (time.perf_counter()-t)*1000,r.status_code,len(r.content)
out={}
for p in paths:
    with cf.ThreadPoolExecutor(conc) as ex: rs=list(ex.map(hit,[p]*n))
    ts=sorted(x[0] for x in rs)
    out[p]=(rs[0][1],rs[0][2],round(ts[len(ts)//2],1),round(ts[int(len(ts)*.95)-1],1))
    print(p,*out[p])
