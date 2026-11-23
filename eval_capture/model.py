def cust(apps=8, price_app=100, setup=250, providers=2, maint=49, months=12,
         hrs_app=3.5, hrs_setup=6, hrs_maint=1.0, efax=10):
    # one-time sprint
    rev1 = setup + apps*price_app
    ach = lambda x: min(0.008*x, 5.0)         # Stripe ACH 0.8% capped $5 (verified stripe.com/pricing)
    fees1 = ach(setup) + apps*ach(price_app)  # assume invoiced per item
    hrs1 = hrs_setup + apps*hrs_app
    var1 = fees1 + efax*3                      # ~3 months of e-fax allocated (estimate)
    c1 = rev1 - var1
    # maintenance
    revm = providers*maint*months
    feesm = months*ach(providers*maint)
    hrsm = providers*hrs_maint*months
    cm = revm - feesm
    return dict(rev1=rev1, var1=round(var1,2), contrib1=round(c1,2), hrs1=hrs1, hr1=round(c1/hrs1,2),
                rev_maint=revm, contrib_maint=round(cm,2), hrs_maint=hrsm, hr_maint=round(cm/hrsm,2),
                yr1_contrib=round(c1+cm,2), yr1_hrs=hrs1+hrsm, yr1_hr=round((c1+cm)/(hrs1+hrsm),2))
base=cust(); print('BASE',base)
print('PESSIMISTIC (6 hrs/app, no maintenance uptake)',cust(hrs_app=6,maint=0,hrs_maint=0.0001))
print('OPTIMISTIC (2 hrs/app, 12 apps)',cust(hrs_app=2,apps=12))
print('PRICE MATCH $99 (no setup fee)',cust(price_app=99,setup=0))
# acquisition: time-only CAC
for reply,close in [(0.02,0.10),(0.05,0.15),(0.08,0.25)]:
    contacts = 1/(reply*close); hrs = contacts*10/60  # 10 min research+personalize+send+follow-up per contact (estimate)
    print(f'reply {reply:.0%} close {close:.0%}: contacts/customer {contacts:.0f}, hrs/customer {hrs:.1f}, '
          f'value of that time at base sprint $/hr {hrs*base["hr1"]:.0f}')
# break-even of fixed startup spend
fixed = 15 + 3*10 + 3*14   # domain, 3 mo e-fax, 3 mo workspace (estimates); E&O excluded
print('fixed 90-day tools excl E&O', fixed, '| customers to cover fixed+E&O(700 est):', round((fixed+700)/base['contrib1'],2))
# weekly capacity: 60 hrs, 25 for selling
deliv=35; print('apps/week deliverable at 3.5h', deliv/3.5, '| sprint customers per month', round(deliv*4.3/base['hrs1'],1))
