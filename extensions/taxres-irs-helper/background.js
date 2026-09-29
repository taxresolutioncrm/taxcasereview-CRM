// TaxRes IRS Helper — background service worker
// Minimal: just keeps the extension alive and handles install event.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TaxRes IRS Helper] Installed v' + chrome.runtime.getManifest().version)
})
