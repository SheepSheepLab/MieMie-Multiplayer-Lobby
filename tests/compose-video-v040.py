import json,pathlib,subprocess,re
import imageio_ffmpeg
root=pathlib.Path('test-results/v040');j=json.loads((root/'timeline.json').read_text());ff=imageio_ffmpeg.get_ffmpeg_exe()
def duration(path):
 s=subprocess.run([ff,'-hide_banner','-i',path],capture_output=True,text=True).stderr
 m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',s);return int(m[1])*3600+int(m[2])*60+float(m[3])
hd,gd=duration(j['host']),duration(j['guest']);shift=max(0,hd-gd);trim=1.0
font='/System/Library/Fonts/STHeiti Medium.ttc'
(root/'title.txt').write_text('咩咩联机大厅 0.4.0 · 大厅 · 行动球 · 聊天球')
(root/'note.txt').write_text('实际脚本界面｜模拟 AI 回复｜演示使用本机信令')
(root/'host-label.txt').write_text('房主 · 星野')
(root/'guest-label.txt').write_text('队友 · 凛')
filters=[f'[0:v]fps=25,setpts=PTS-STARTPTS[h]',f'[1:v]fps=25,setpts=PTS-STARTPTS,tpad=start_duration={shift}:start_mode=clone[g]',f'[h][g]hstack=inputs=2:shortest=1,trim=start={trim},setpts=PTS-STARTPTS,pad=1300:1130:0:120:color=0x07121d[v0]']
prev='v0';index=0
def text(file,x,y,size,color='white',enable=None):
 global prev,index
 index+=1;n='v'+str(index)
 f=f"[{prev}]drawtext=fontfile='{font}':textfile='{file}':x={x}:y={y}:fontsize={size}:fontcolor={color}"
 if enable:f+=f":enable='{enable}'"
 filters.append(f+'['+n+']');prev=n
text(root/'title.txt',30,18,34,'0xe0c48b');text(root/'note.txt',30,65,23,'0x8aa6b5');text(root/'host-label.txt',30,92,22);text(root/'guest-label.txt',680,92,22)
for i,e in enumerate(j['events']):
 p=root/f'caption-{i}.txt';p.write_text(e['text']);start=max(0,e['at']-trim);end=max(0,(j['events'][i+1]['at'] if i+1<len(j['events']) else hd+2)-trim)
 text(p,30,1070,24,'0xd6c089',f'gte(t,{start})*lt(t,{end})')
(root/'filters.txt').write_text(';\n'.join(filters))
out='dist/MieMie-Lobby-0.4.0-Demo.mp4'
r=subprocess.run([ff,'-hide_banner','-loglevel','warning','-y','-i',j['host'],'-i',j['guest'],'-filter_complex_script',str(root/'filters.txt'),'-map','['+prev+']','-an','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',out]);r.check_returncode()
for second in [6,18,30]:subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-ss',str(second),'-i',out,'-frames:v','1',str(root/f'check-{second}.png')],check=True)
print(json.dumps({'video':out,'duration':duration(out),'hostRaw':hd,'guestRaw':gd,'alignment':shift},ensure_ascii=False))
