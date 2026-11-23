# 90-day model, weeks 1..13 (Nov 30 2026 - Feb 28 2027). Week 0 = setup (Nov 23-29).
def glass(close=0.03, price=25.0, convos_per_day=20, skip=0.25, churn_wk=0.012,
          pitch_days=lambda w: 3 if w<=4 else 2, collect_lag_wks=2, label=""):
    setup = 180+50+40+60+20          # kit, MN assumed name, cards/door hangers, insurance mo1, additive
    monthly_ins, additive_mo = 60, 17
    accts = 0.0; billed=[]; costs=setup; hours=0.0; pending=0.0
    for w in range(1,14):
        start = accts                       # accounts closed last week start service this week
        convos = pitch_days(w)*convos_per_day
        new = convos*close
        # service: biweekly -> half of accounts visited each week; skip% lost in winter
        visits = start*0.5*(1-skip)
        rev = visits*price
        billed.append(rev)
        # hours: 5h per pitch day incl. transit; 20 min/stop incl walking + 1h transit per service day
        svc_days = 0 if visits==0 else (1 if visits<=12 else 2)
        hours += pitch_days(w)*5 + visits*(20/60) + svc_days*1.0
        days_out = pitch_days(w)+svc_days
        costs += days_out*4 + additive_mo/4.33 + rev*0.03
        if w in (5,9): costs += monthly_ins
        accts = start*(1-churn_wk) + new
    gross = sum(billed); collected = sum(billed[:13-collect_lag_wks])
    run_rate_mo = accts*price*2.17          # month-4 billing at full biweekly, no skip (spring)
    deliv_rate = price/(20/60)              # gross $/delivery hour ignoring transit to cluster
    return dict(label=label, accts_d90=round(accts,1), gross_rev=round(gross), cash_in=round(collected),
                costs=round(costs), net_cash=round(collected-costs), founder_hrs=round(hours),
                net_per_hr=round((collected-costs)/hours,2), runrate_mo_spring=round(run_rate_mo),
                gross_per_delivery_hr=round(deliv_rate))

def janitorial(price=60.0, starts=(5,9,12), visits_wk=2, label=""):
    setup = 112+150+50+50             # bond yr, supplies, assumed name, insurance mo1
    rev=[]; costs=setup; hours=0
    for w in range(1,14):
        n = sum(1 for s in starts if w>=s)
        r = n*visits_wk*price; rev.append(r)
        hours += 15 + n*visits_wk*2.25   # 15h/wk selling; 1.25h clean + 1h transit per visit
        costs += n*visits_wk*4/2 + 25/4.33 + r*0.03   # ~$2 fare each way per visit
        if w in (5,9): costs += 50
    collected = sum(rev[:13-4])          # net-30 terms typical for office contracts
    return dict(label=label, gross_rev=round(sum(rev)), cash_in=round(collected), costs=round(costs),
                net_cash=round(collected-costs), founder_hrs=round(hours),
                gross_per_delivery_hr=round(price/2.25,1), runrate_mo=round(len(starts)*visits_wk*price*4.33))

def snow(accts=4, retainer=120.0, events=8, hrs_per_event=3.5, label=""):
    setup = 60+50+40+132             # shovels/scraper, assumed name, flyers, insurance mo1
    rev = accts*retainer*3           # Dec, Jan, Feb
    costs = setup + 132*2 + 8*25 + events*4   # insurance mo2-3, ice melt, transit per event
    hours = 60 + events*hrs_per_event    # selling + events
    return dict(label=label, gross_rev=round(rev), costs=round(costs), net_cash=round(rev-costs),
                founder_hrs=round(hours), net_per_hr=round((rev-costs)/hours,2))

print("GLASS ROUTE")
for c,l in [(0.03,"conservative 3% close"),(0.06,"base 6% close"),(0.015,"bear 1.5% close")]:
    print(glass(close=c,label=l))
print("sens: price $20, 3% close:", glass(close=0.03,price=20,label="price20"))
print("sens: skip 50%, 3% close:", glass(close=0.03,skip=0.5,label="skip50"))
print("breakeven close rate (net_cash>=0) search:")
for c in [x/1000 for x in range(10,80,5)]:
    r=glass(close=c)
    if r['net_cash']>=0: print("  close", c, r); break
print("close needed for $3k/mo spring run-rate:")
for c in [x/1000 for x in range(10,200,5)]:
    r=glass(close=c)
    if r['runrate_mo_spring']>=3000: print("  close", c, r['accts_d90'], r['runrate_mo_spring']); break
print("\nJANITORIAL"); print(janitorial(label="conservative 3 clients"))
print("\nSNOW"); print(snow(label="conservative 4 accts, El Nino 8 events")); print(snow(accts=8,label="base 8 accts"))
