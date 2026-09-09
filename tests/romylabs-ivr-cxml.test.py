from xml.etree import ElementTree as ET
from urllib.parse import quote

BASE = "https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1"
TENANT = "a0000000-0000-0000-0000-000000000001"
CALLSID = "sandbox-call-123"
FROM = "+15555550123"
TO = "+15614206999"

def attr(value):
    return str(value).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

def conference_xml(digit):
    conf = f"romylabs-{digit}-{CALLSID}"
    status = attr(f"{BASE}/caller-hangup?conf={quote(conf, safe='')}&tenant={TENANT}")
    recording = attr(f"{BASE}/call-recorded?tenant={TENANT}&callsid={quote(CALLSID, safe='')}&from={quote(FROM, safe='')}&to={quote(TO, safe='')}")
    return f'''<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="false" endConferenceOnExit="false" statusCallback="{status}" statusCallbackEvent="leave end" statusCallbackMethod="POST" record="record-from-start" recordingStatusCallback="{recording}">{conf}</Conference></Dial></Response>'''

for digit in "1234":
    raw = conference_xml(digit)
    root = ET.fromstring(raw)
    conference = root.find("./Dial/Conference")
    assert conference is not None
    assert conference.attrib["startConferenceOnEnter"] == "false"
    assert "&tenant=" in conference.attrib["statusCallback"]
    assert "&callsid=" in conference.attrib["recordingStatusCallback"]
    serialized_status = raw.split('statusCallback="', 1)[1].split('"', 1)[0]
    serialized_recording = raw.split('recordingStatusCallback="', 1)[1].split('"', 1)[0]
    assert "&amp;tenant=" in serialized_status
    assert "&amp;callsid=" in serialized_recording
    assert "&tenant=" not in serialized_status
    assert "&callsid=" not in serialized_recording

prompt = "Thanks for calling RomyLabs. For sales, press 1. For support, press 2. For billing, press 3. To speak with a representative, press 4. To leave a voicemail, press 5."
greeting = f'''<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" timeout="8" action="{BASE}/romylabs-ivr-route" method="POST"><Say voice="Polly.Joanna-Neural" language="en-US">{prompt}</Say></Gather><Redirect method="POST">{BASE}/romylabs-ivr-route</Redirect></Response>'''
root = ET.fromstring(greeting)
say = root.find("./Gather/Say")
assert say is not None
assert say.attrib["voice"] == "Polly.Joanna-Neural"
assert "representative" in (say.text or "").lower()
assert "romy directly" not in (say.text or "").lower()

voicemail = f'''<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">{BASE}/romylabs-voicemail-prompt</Redirect></Response>'''
assert ET.fromstring(voicemail).find("./Redirect") is not None

outbound_cb = f"{BASE}/call-recorded?tenant={TENANT}&amp;conf=outbound-test"
outbound = f'''<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" recordingStatusCallback="{outbound_cb}">outbound-test</Conference></Dial></Response>'''
out_root = ET.fromstring(outbound)
out_conf = out_root.find("./Dial/Conference")
assert out_conf is not None
assert "&conf=outbound-test" in out_conf.attrib["recordingStatusCallback"]

print("ROMYLABS_IVR_CXML_PASS")
