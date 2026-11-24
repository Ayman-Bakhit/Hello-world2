# TCPA statutory-damages exposure scenarios. All volume/defect inputs are ASSUMPTIONS, not data.
STAT_MIN, STAT_TREBLE = 500, 1500  # 47 U.S.C. 227(b)(3)(B) and treble clause
clinics, patients, calls_per_patient = 50, 1500, 6   # assumed year-1 scale: 4 reminder + 2 recall calls/yr
total = clinics * patients * calls_per_patient
print(f"Annual calls (A+B): {clinics} x {patients} x {calls_per_patient} = {total:,}")
for rate in (0.001, 0.005, 0.02):
    bad = round(total * rate)
    print(f"  defect rate {rate:.1%}: {bad:,} bad calls -> ${bad*STAT_MIN:,} (base) / ${bad*STAT_TREBLE:,} (treble)")
promo = 2000
print(f"One clinic, one whitening blast to {promo:,} patients w/o written consent: ${promo*STAT_MIN:,} / ${promo*STAT_TREBLE:,}")
