# Requires ia_reval.json: Iowa rows of CMS Revalidation Reassignment List (Nov 2026), fetched via
# https://data.cms.gov/data-api/v1/dataset/20f51cff-4137-4f3a-b6b7-bfc9ad57983b/data?filter[Group State Code]=IA&size=5000&offset=N
# Dollar inputs below are scenario estimates, not verified prices.
import json,datetime
from collections import Counter
rows=json.load(open('ia_reval.json'))
g={}
for x in rows:
    g.setdefault(x['Group Enrollment ID'],(x['Group Due Date'],x['Group Reassignments and Physician Assistants']))
def d(s):
    try: return datetime.datetime.strptime(s,'%m/%d/%Y')
    except: return None
asof=datetime.datetime(2026,11,23)
n=len(g); tbd=sum(1 for v in g.values() if v[0]=='TBD')
past=sum(1 for v in g.values() if d(v[0]) and d(v[0])<asof)
fut=[v for v in g.values() if d(v[0]) and d(v[0])>=asof]
small_fut=[v for v in fut if v[1].isdigit() and 1<=int(v[1])<=15]
print(f"IA rows={len(rows)} groups={n} TBD={tbd} past_due_listed={past} future_dated={len(fut)} future_small(1-15 reassign)={len(small_fut)}")
print("future small by month:",sorted(Counter(v[0][:2]+'/'+v[0][-4:] for v in small_fut).items()))
# ---- economics (scenario inputs; vendor-blog price ranges, not verified quotes)
startup={'EIN (IRS, free)':0,'Iowa LLC filing (optional; est.)':50,'E&O insurance first-month or quote (est.)':0,
 'Google Workspace 1 mo (est.)':14,'password manager 1 yr (est.)':40,'mileage 7-day test 4 trips x 40mi x $0.70':4*40*0.70}
print("startup:",startup,"total",sum(startup.values()))
# pilot revenue
pilot_fee=250; hours_pilot=10   # Medicare group reval + 3 reassignments + CAQH check, first-timer est.
print(f"pilot: ${pilot_fee} / {hours_pilot}h = ${pilot_fee/hours_pilot:.0f}/h before costs")
# retainer scenario
for price in (75,150,250):
    for prov in (3,):
        mrr=price*prov
        print(f"retainer ${price}/provider/mo x {prov} providers = ${mrr}/mo per practice; practices needed for $4,000/mo gross: {4000/mrr:.1f}")
# capacity: hours per provider-month maintenance est 1.5h
hpm=1.5; hours=40*4.33
print(f"capacity at {hpm}h/provider-month: {hours/hpm:.0f} provider-months -> at $150 = ${hours/hpm*150:,.0f}/mo gross ceiling")
# new provider full enrollment, 6 payers at $100-300
for p in (100,200,300): print(f"new provider, 6 payers x ${p} = ${6*p}")
# E&O annual sensitivity vs pilot fees
for eo in (500,1000,1500): print(f"E&O ${eo}/yr = {eo/pilot_fee:.1f} pilots of ${pilot_fee} just to cover insurance")
