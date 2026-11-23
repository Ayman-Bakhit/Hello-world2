import numpy as np, datetime as dt
start=dt.date(2026,11,23); deadline=start+dt.timedelta(days=30)
hol=['2026-11-26','2026-12-25','2027-01-01']
def bd(d,n): return np.busday_offset(np.datetime64(d),n,roll='forward',holidays=hol).astype(object)
print("30-day deadline:",deadline)
# Best case: apply Nov 24 (after ID proofing Nov 23), 8 business-day minimum review, publish next business day, 10 calendar-day protest, grant next business day
for label,apply_lag,review,pub_lag,grant_lag in [("best",1,8,1,1),("typical-ish (+10bd vetting)",2,18,2,3),("flagged (+20bd)",2,28,3,5)]:
    a=start+dt.timedelta(days=apply_lag)
    r=bd(a,review); p=bd(r,pub_lag); prot=p+dt.timedelta(days=10); g=bd(prot,grant_lag)
    print(f"{label}: apply {a}, review done {r}, published {p}, protest ends {prot}, active ~{g}, slack vs deadline {(deadline-g).days}d")
# Cash gate
cash=1000; fee=300; boc3_self=0
left=cash-fee
print("cash after $300 fee:",left)
for prem_pct in [0.5,1,1.25,2,3,5,10]:
    prem=75000*prem_pct/100
    print(f"premium {prem_pct}% of 75k = ${prem:,.0f} -> remaining ${left-prem:,.0f}")
print("max affordable premium rate (no BOC-3 cost, no other costs): %.3f%%"%(left/75000*100))
print("with $100 BOC-3 blanket-agent cost (est.): %.3f%%"%((left-100)/75000*100))
print("BMC-85 trust path cash needed: $%d + $300 = $%d vs $1,000 available -> shortfall $%d"%(75000,75300,75300-1000))
# commission breakeven: loads needed at margin assumptions to pay a premium
for prem in [1125,2250,3750]:
    for m in [150,250,400]:
        print(f"premium ${prem}: loads at ${m} net margin to recoup = {prem/m:.1f}")
