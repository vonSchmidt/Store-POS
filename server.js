let express = require("express"),
  http = require("http"),
  path = require("path"),
  app = require("express")(),
  server = http.createServer(app),
  bodyParser = require("body-parser");

const PORT = process.env.PORT || 8001;
const APP_DIR = __dirname;

console.log("Server started");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Static assets for browser clients
app.use('/assets',      express.static(path.join(APP_DIR, 'assets')));
app.use('/node_modules', express.static(path.join(APP_DIR, 'node_modules')));
app.use('/uploads',     express.static(path.join(process.env.APPDATA || '', 'POS', 'uploads')));

app.all("/*", function(req, res, next) {
 
  res.header("Access-Control-Allow-Origin", "*");  
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-type,Accept,X-Access-Token,X-Key"
  );
  if (req.method == "OPTIONS") {
    res.status(200).end();
  } else {
    next();
  }
});

app.get("/", function(req, res) {
  const wantHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (wantHtml) {
    res.sendFile(path.join(APP_DIR, 'index.html'));
  } else {
    res.send("POS Server Online.");
  }
});

app.use("/api/inventory", require("./api/inventory"));
app.use("/api/customers", require("./api/customers"));
app.use("/api/categories", require("./api/categories"));
app.use("/api/settings", require("./api/settings"));
app.use("/api/users", require("./api/users"));
app.use("/api", require("./api/transactions"));

server.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));
