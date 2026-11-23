# Population (NASS Livestock Slaughter 2025 Summary, Apr 2026; plant counts as of Jan 1, 2026)
fi, nfi = 1127, 1796
print("US slaughter plants total:", fi+nfi)
small_fi_cattle = 677   # FI cattle plants killing 1-999 head in 2025
print("Small-ish pool (NFI + FI cattle 1-999), upper bound w/ possible overlap w/ hog-only:", nfi+small_fi_cattle)
ia_fi, ia_nfi = 31, 95
print("Iowa plants:", ia_fi+ia_nfi)

# Launch budget (estimates; prices unverified unless noted)
budget = {"domain (1 yr)":15, "Google Voice number":0, "Jotform/Google Forms free tier":0,
          "printed one-pagers (50)":30, "mileage: 4 in-person visits x 150 mi x $0.70":4*150*0.70,
          "phone/data overage buffer":25, "contingency":100}
for k,v in budget.items(): print(f"  {k}: ${v:,.2f}")
tot=sum(budget.values()); print("Launch budget total: $%.2f (cap $1,000, headroom $%.2f)"%(tot,1000-tot))

# Contribution per paid pilot
def contrib(price, miles, hrs, stripe=True):
    fee = price*0.029+0.30 if stripe else 0
    var = fee + miles*0.70
    c = price-var
    return c, var, c/hrs
for price,miles,hrs,lab in [(300,150,10,"base: $300, 1 visit, 10 h"),(300,0,8,"remote onboarding"),(150,150,10,"low price"),(300,150,20,"time blowout")]:
    c,v,h=contrib(price,miles,hrs); print(f"{lab}: variable ${v:.2f}, contribution ${c:.2f}, per founder-hour ${h:.2f}")

# Ceiling: recurring service at $150/mo
for n in (10,25,50,100):
    print(f"{n} processors x $150/mo = ${n*150*12:,}/yr revenue; at 3 h/mo each = {n*3} h/mo")
print("Share of 2,923 plants needed for 50 clients: %.1f%%"%(50/2923*100))
