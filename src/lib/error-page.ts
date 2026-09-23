export function renderErrorPage(options: { tv?: boolean } = {}): string {
  const tv = options.tv === true;
  const homeHref = tv ? "/?tv=1" : "/";
  const homeLabel = tv ? "Open simple TV mode" : "Go home";
  const message = tv
    ? "The TV browser could not start the full app. Open simple TV mode to browse the library with the remote."
    : "Something went wrong on our end. You can try refreshing or head back home.";
  // Keep this recovery path ES5-only: it is used precisely when the TV cannot
  // run the normal application bundle. It is guarded against ?tv=1 so a
  // failing static response cannot redirect forever.
  const tvRecoveryScript = tv
    ? `<script>(function(){try{if(location.search.indexOf("tv=1")===-1){location.replace("/?tv=1");}}catch(e){}})();</script>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 32rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>${message}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="${homeHref}">${homeLabel}</a>
      </div>
    </div>
    ${tvRecoveryScript}
  </body>
</html>`;
}
