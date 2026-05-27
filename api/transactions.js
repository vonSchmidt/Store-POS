let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("@seald-io/nedb");
let Inventory = require("./inventory");

app.use(bodyParser.json());

module.exports = app;
 
let transactionsDB = new Datastore({
  filename: process.env.APPDATA+"/POS/server/databases/transactions.db",
  autoload: true
});


transactionsDB.ensureIndex({ fieldName: '_id', unique: true });

app.get("/", function(req, res) {
  res.send("Transactions API");
});

 
app.get("/all", function(req, res) {
  transactionsDB.find({}, function(err, docs) {
    res.send(docs);
  });
});



 
app.get("/on-hold", function(req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: {$ne: ""}}, { status: 0  }]},
    function(err, docs) {
      if (err) res.status(500).send(err);
      else res.send(docs);
    }
  );
});



app.get("/customer-orders", function(req, res) {
  transactionsDB.find(
    { $and: [{ customer: {$ne: "0"} }, { status: 0}, { ref_number: ""}]},
    function(err, docs) {
      if (err) res.status(500).send(err);
      else res.send(docs);
    }
  );
});



app.get("/by-date", function(req, res) {

  let startDate = new Date(req.query.start);
  let endDate = new Date(req.query.end);

  const dateFilter = { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } };
  const statusFilter = { status: parseInt(req.query.status) };
  const userFilter = req.query.user != 0 ? { user_id: parseInt(req.query.user) } : null;
  const tillFilter = req.query.till != 0 ? { till: parseInt(req.query.till) } : null;
  const conditions = [dateFilter, statusFilter];
  if (userFilter) conditions.push(userFilter);
  if (tillFilter) conditions.push(tillFilter);

  transactionsDB.find({ $and: conditions }, function(err, docs) {
    if (err) res.status(500).send(err);
    else res.send(docs);
  });

});



app.post("/new", function(req, res) {
  let newTransaction = req.body;
  transactionsDB.insert(newTransaction, function(err, transaction) {
    if (err) res.status(500).send(err);
    else {
      res.sendStatus(200);
      if (parseFloat(newTransaction.paid) >= parseFloat(newTransaction.total)) {
        Inventory.decrementInventory(newTransaction.items);
      }
    }
  });
});



app.put("/new", function(req, res) {
  let orderId = req.body._id;
  // Fetch existing record first so we only decrement inventory once (on unpaid→paid transition)
  transactionsDB.findOne({ _id: orderId }, function(err, existing) {
    transactionsDB.update({ _id: orderId }, req.body, {}, function(err, numReplaced) {
      if (err) res.status(500).send(err);
      else {
        res.sendStatus(200);
        const wasUnpaid = existing && existing.status !== 1;
        if (wasUnpaid && parseFloat(req.body.paid) >= parseFloat(req.body.total)) {
          Inventory.decrementInventory(req.body.items);
        }
      }
    });
  });
});


app.post( "/delete", function ( req, res ) {
 let transaction = req.body;
  transactionsDB.remove( {
      _id: transaction.orderId
  }, function ( err, numRemoved ) {
      if ( err ) res.status( 500 ).send( err );
      else res.sendStatus( 200 );
  } );
} );



app.get("/:transactionId", function(req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function(err, doc) {
    if (err) res.status(500).send(err);
    else res.send(doc[0]);
  });
});
