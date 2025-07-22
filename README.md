# Generic Report Designer

Written in javascript under electron js

### build
```bash
npm install
npm run dist
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

