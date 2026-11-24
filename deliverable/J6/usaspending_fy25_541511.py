import json, urllib.request, sys
API="https://api.usaspending.gov/api/v2"
def post(path, body):
    req=urllib.request.Request(API+path, data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(req, timeout=180))
def filt(setaside=None):
    f={"time_period":[{"start_date":"2024-10-01","end_date":"2025-09-30"}],
       "award_type_codes":["A","B","C","D"],"naics_codes":{"require":["541511"]}}
    if setaside: f["set_aside_type_codes"]=setaside
    return f
def by_agency(f):
    out=[];p=1
    while True:
        r=post("/search/spending_by_category/awarding_agency/",{"filters":f,"category":"awarding_agency","limit":100,"page":p})
        out+=r["results"]
        if not r["page_metadata"]["hasNext"]: break
        p+=1
    return out
def over_time(f):
    return post("/search/spending_over_time/",{"group":"fiscal_year","filters":f})
res={}
for label,sa in [("all",None),("SBA_total_sb",["SBA"]),("SBP_partial_sb",["SBP"])]:
    f=filt(sa)
    ag=by_agency(f)
    ot=over_time(f)
    res[label]={"agencies":ag,"sum_agencies":sum(a["amount"] for a in ag),"over_time":ot["results"]}
    print(label, "n_agencies",len(ag),"sum",round(res[label]["sum_agencies"],2), "over_time",ot["results"])
json.dump(res,open("results.json","w"),indent=1)
