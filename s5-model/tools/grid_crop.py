# usage: crop.py img x0 y0 x1 y1 out [scale] [gridpx]
import sys
from PIL import Image, ImageDraw
a=sys.argv
im=Image.open(a[1]).convert('RGB')
x0,y0,x1,y1=map(int,a[2:6]); out=a[6]
sc=float(a[7]) if len(a)>7 else 3
g=int(a[8]) if len(a)>8 else 10
c=im.crop((x0,y0,x1,y1)).resize((int((x1-x0)*sc),int((y1-y0)*sc)),Image.LANCZOS)
d=ImageDraw.Draw(c)
for x in range((x0//g+1)*g,x1,g):
    X=(x-x0)*sc; d.line([(X,0),(X,c.height)],fill=(255,0,255) if x%(g*5)==0 else (0,200,255),width=1)
    if x%(g*5)==0: d.text((X+2,2),str(x),fill=(255,0,0))
for y in range((y0//g+1)*g,y1,g):
    Y=(y-y0)*sc; d.line([(0,Y),(c.width,Y)],fill=(255,0,255) if y%(g*5)==0 else (0,200,255),width=1)
    if y%(g*5)==0: d.text((2,Y+2),str(y),fill=(255,0,0))
c.save(out)
