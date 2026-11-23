# Population (verified inputs)
vs, sm, lg = 2961, 2847, 508            # FSIS, as of Dec 2025 (91 FR, Mar 24 2026)
print("FSIS total:", vs+sm+lg, "| very small share: %.1f%%" % (100*vs/(vs+sm+lg)))
# Assumption (UNVERIFIED): share of very small plants doing fee-for-service work for farmers with cut sheets
for share in (0.3, 0.6):
    print(f"serviceable very-small plants @ {share:.0%}: {round(vs*share)}")
# Produce (verified inputs)
veg, fresh = 69452, 64075
print("fresh-market share of veg farms: %.1f%%" % (100*fresh/veg))
print("veg-specializing farms >= $100k sales: %d%%" % (10+3+8))
# Pilot contribution (scenario inputs; fees from memory, UNVERIFIED)
def contrib(price, tools=30.0, pct=0.029, fixed=0.30, hours=20):
    fee = price*pct + fixed
    c = price - fee - tools
    return fee, c, c/hours
for p in (300, 500, 750):
    fee, c, hr = contrib(p)
    print(f"price ${p}: card fee ${fee:.2f}, tools $30, contribution ${c:.2f}, per founder-hour (20h) ${hr:.2f}")
# Launch budget
budget = {"domain (est.)":15, "one-page site, 1 mo (est.)":20, "texting/VoIP number, 1 mo (est.)":25,
          "form tool (free tier)":0, "card processor setup":0, "FSIS/state directories":0}
spent = sum(budget.values()); print("committed:", spent, "| untouched reserve:", 1000-spent)
# Test funnel and kill math
dials, reach_rate = 60, 0.30
reached = dials*reach_rate
print("decision-makers reached from", dials, "dials @30%:", reached)
print("pilots needed to pass:", 2, "=> conversion of reached:", "%.1f%%" % (100*2/reached))
# Month-1 revenue if pass at minimum
print("Day-30 cash at minimum pass (2 x $500):", 2*500, "| contribution:", round(2*contrib(500)[1],2), "| net of launch spend:", round(2*contrib(500)[1]-spent,2))
# Ceiling sanity: one founder at 60 h/wk, 20 h per client-month
cap = (60*4.33)//20
print("max concurrent clients @20h each:", cap, "| monthly contribution ceiling @ $500:", round(cap*contrib(500)[1],2))
