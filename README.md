# Generic Report Designer

Written in javascript under electron js

### build
```bash
npm install
npm run dist
# for windows
npm run dist:win
```
copy the executable from <workspace>/dist/Report Designer-1.0.0-x86_64.AppImage and paste somewhere else 
open terminal and look for the chrome executable file 

```bash
whereis google-chrome-stable
```

create environment file .env alongside the executable and write the config below, path should come from the whereis result command

```bash
CHROME_PATH=/usr/bin/google-chrome-stable
```

file is save as <filename>.zrpt which used BSON encoding


# Report Server

```text
run docker-compose.yml
copy libs folder to temp
if needed, from temp/linux*, extract the chrome package
```

#### Get Request
```curl
curl --request GET \
  --url http://localhost:8088/render/tpl-issuance-history.zrpt/ppp.json \
  --header 'accept: text/plain'
```
- make sure tpl-issuance-history.zrpt exists in temp/report
- make sure ppp.json exists in temp/data

#### Post Request
```curl
curl --request POST \
  --url http://localhost:8088/render/tpl-issuance-history.zrpt \
  --header 'accept: text/plain' \
  --header 'content-type: application/json' \
  --data '<json data here>'
```

