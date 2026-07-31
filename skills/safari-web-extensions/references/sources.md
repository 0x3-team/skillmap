# Safari Web Extension Sources

Use these as starting points. Verify current details live before implementation or release.

- Apple Safari Extensions overview: https://developer.apple.com/safari/extensions/
- Apple Creating a Safari web extension: https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension
- Apple Running your Safari web extension: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension
- Apple Packaging a web extension for Safari: https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari
- Apple Messaging between the app and JavaScript: https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension
- Apple Assessing browser compatibility: https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility
- Apple Optimizing for Safari: https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari
- Apple Syncing Safari web extensions: https://developer.apple.com/documentation/safariservices/syncing-safari-web-extensions-across-devices-and-platforms
- Apple Troubleshooting Safari web extensions: https://developer.apple.com/documentation/safariservices/troubleshooting-your-safari-web-extension
- MDN manifest.json reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json
- MDN Browser extensions reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions

## Local Documentation JSON

Apple documentation pages are often JavaScript-rendered. The same content can usually be fetched with:

```bash
curl -L -s https://developer.apple.com/tutorials/data/documentation/safariservices/<slug>.json
```

Useful slugs:

- `creating-a-safari-web-extension`
- `running-your-safari-web-extension`
- `packaging-a-web-extension-for-safari`
- `messaging-between-the-app-and-javascript-in-a-safari-web-extension`
- `assessing-your-safari-web-extension-s-browser-compatibility`
- `optimizing-your-web-extension-for-safari`
- `syncing-safari-web-extensions-across-devices-and-platforms`
- `troubleshooting-your-safari-web-extension`
