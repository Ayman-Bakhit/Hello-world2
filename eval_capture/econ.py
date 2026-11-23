# First-customer economics, credentialing/enrollment pilot. All inputs are ESTIMATES unless noted.
budget=1000
fixed_startup={ 'LLC filing (Iowa, unverified est)':50, 'domain+email 3 mo':40,
  'encrypted storage/password mgr 3 mo':30, 'E&O/general liability 3 mo (est)':150 }
startup=sum(fixed_startup.values())
print("startup cash out:",startup,"remaining:",budget-startup)
# Pilot: 2 new clinicians x 4 payers (e.g. Medicare? no - BH group: Wellmark, 2-3 Medicaid MCOs, 1 other)
clin,payers=2,4
apps=clin*payers
for price_app,label in [(99,'match MedSole floor'),(150,'mid-low market'),(250,'upper typical')]:
  for hrs_per_app in (3,5,8):
    rev=apps*price_app
    caqh=clin*75*3   # $75/provider/mo maintenance x 3 months (est; MGMA-quoted $66-129 unverified)
    hrs=apps*hrs_per_app + clin*2*3  # +2 hrs/provider/mo CAQH upkeep
    tot=rev+caqh
    print(f"${price_app}/app ({label}), {hrs_per_app}h/app: revenue ${tot}, hours {hrs}, $/hr {tot/hrs:.0f}")
# cash timing if paid on approval (MedSole model) vs 50% upfront
print("\nPay-on-approval: cash arrives ~60-120 days after submission (MGMA/Medallion delay data);")
print("50% deposit at $150/app:", apps*150*0.5, "upfront")
# Full-time capacity ceiling
hrs_week=40; sell_frac=0.5  # half time selling in year 1 (est)
for h in (3,5):
  apps_yr=hrs_week*(1-sell_frac)*48/h
  print(f"capacity @ {h}h/app: {apps_yr:.0f} apps/yr -> gross ${apps_yr*150:,.0f} at $150")
