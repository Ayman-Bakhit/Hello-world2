import json,sys,urllib.parse,urllib.request,os
# corridor boxes (lat/lon WGS84), rough; label: (minx,miny,maxx,maxy)
C={
 'Lake St (Hiawatha->Lyndale)':(-93.2880,44.9478,-93.2330,44.9492),
 'Central Ave NE (Lowry->Broadway)':(-93.2482,44.9990,-93.2462,45.0130),
 'Nicollet Ave (Franklin->Lake)':(-93.2785,44.9490,-93.2770,44.9630),
 'E Hennepin/University SE':(-93.2560,44.9830,-93.2400,44.9910),
}
out={}
for Y in ['2025','2026']:
  B=f'https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Public_311_{Y}/FeatureServer/0/query'
  for k,(a,b,c,d) in C.items():
    q={'where':"SUBJECTNAME='Sidewalks' AND TYPENAME LIKE '%Snow%'",'geometry':f'{a},{b},{c},{d}','geometryType':'esriGeometryEnvelope','inSR':'4326','spatialRel':'esriSpatialRelIntersects','returnCountOnly':'true','f':'json'}
    u=B+'?'+urllib.parse.urlencode(q)
    r=json.load(urllib.request.urlopen(u))
    print(Y,k,r.get('count'),r.get('error',''))
