from datetime import date, timedelta
from decimal import Decimal as D
for d in [date(2026,11,23),date(2026,11,24),date(2026,11,26),date(2026,11,27),date(2026,12,1),date(2026,12,8),date(2026,12,15),date(2026,12,18)]:
    print(d, d.strftime('%a'))
units, price = 40, D(120)
rev = units*price; half = rev/2
fee = lambda amt, pct=D('0.029'): (amt*pct + D('0.30')).quantize(D('0.01'))
f1 = fee(half); fees = 2*f1; net1 = half - f1
print('rev',rev,'charge',half,'fee/charge',f1,'total fees',fees,'net per charge',net1)
costs = D(2600)+D(360)+D(120)
profit = rev - fees - costs
print('costs',costs,'profit',profit, 'margin', (profit/rev*100).quantize(D('0.1')))
print('intl card extra total', 2*half*D('0.015'), 'manual entry extra', 2*half*D('0.005'))
print('profit if intl', profit-2*half*D('0.015'))
print('loss if 2nd payment never arrives', net1 - costs)
def sched(payout_day, label):
    cash = D(900); out=[]; mn=cash
    ev = {date(2026,11,27):-D(2600), date(2026,12,1):-D(120), date(2026,12,15):-D(360)}
    d = date(2026,11,23)
    while d <= date(2026,12,18):
        if d == payout_day: cash += net1
        if d in ev: cash += ev[d]
        mn=min(mn,cash); out.append((d,cash)); d+=timedelta(1)
    print('\n',label,'min',mn)
    for d,c in out: print(d.strftime('%a %b %d'), c)
sched(date(2026,11,27),'founder assumption (payout lands Nov 27)')
sched(date(2026,12,1),'Stripe 7 days (Dec 1)')
sched(date(2026,12,8),'Stripe 14 days (Dec 8)')
# wire alternative
cash = D(900)+half; print('\nwire alt: Nov24',cash,'Nov27',cash-2600,'Dec1',cash-2720,'Dec15',cash-3080,'Dec18 after 2nd wire',cash-3080+half,'profit',rev-costs)
print('ending check', 900+profit)
