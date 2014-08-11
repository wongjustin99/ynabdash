function App(settings){
  var self = this;
  var client = self.client = new Client(settings);
  var rootFile = ".ynabSettings.yroot";
  var appSettings = { client: client, app: self };
  self.numberFormat = '0,0.00';
  self.errorMessage = ko.observable();
  self.budget = new BudgetController(appSettings);
  self.payee = new PayeeController(appSettings)
  self.category = new CategoryController(appSettings);
  self.transaction = new TransactionController(appSettings);
  self.monthlyCategoryBudget = new MonthlyCategoryBudgetController(appSettings);

  client.authenticate().then(function(){
    client.loadJson(rootFile).then(function(root){
      self.budget.budgets(root.relativeKnownBudgets);
      if(self.budget.budgets().length === 1){
        self.budget.select(self.budget.budgets()[0])
      }
    }).fail(function(){
      self.errorMessage("Unable to load YNAB settings file (" + rootFile + "). Make sure you connect to a Dropbox account with that YNAB syncs with.");
    });
  });
}

function PayeeController(settings){
  var self = this;
  self.payees = ko.observableArray();

  var lookup = ko.computed(function(){
    return _.indexBy(self.payees(), 'entityId')
  })

  self.lookup = function(id) {
    return lookup()[id] || {};
  }
}

function CategoryController(settings) {
  var self = this;
  self.categories = ko.observableArray();

  var lookup = ko.computed(function(){
    return _.indexBy(self.categories(), 'entityId')
  })

  var specialLookup = {
    "Category/__ImmediateIncome__": { name: "Income" }
  }

  self.lookup = function(id) {
    return lookup()[id] || specialLookup[id] || {};
  }
}

function MonthlyCategoryBudgetController(settings){
  var self = this;
  self.monthlyCategoryBudgets = ko.observableArray();
  self.filteredMonthlyCategoryBudgets = ko.computed(function(){

      // todo: allow month to be adjusted

      var monthlyCategoryBudgets = _.chain(self.monthlyCategoryBudgets()).where({month: '2014-08-01'}).map(function(monthlyCategoryBudget){
        return new MonthlyCategoryBudget(settings.app, monthlyCategoryBudget);
    });

    return monthlyCategoryBudgets.value();
  });
}

function TransactionController(settings){
  var self = this;
  self.transactions = ko.observableArray();

  self.sortBy = ko.observable();
  self.desc = ko.observable(true);

  self.sort = function(column) {
    return function() {
      self.desc(!self.desc());
      self.sortBy(column);
    }
  }

  var filters = {
    "date": new Filter("Date", "date", function(transaction) { 
      return transaction.date;
    }, function(transaction, on) {
      return transaction.date === on.date;
    }),
    "payee": new Filter("Payee", "payee", function(t) {
      return t.payeeName;
    }, function(t, on) {
      return t.payeeId === on.payeeId;
    }),
    "category": new Filter("Category", "category", function(t) {
      return t.categoryName;
    }, function(t, on) {
      return t.categoryId === on.categoryId;
    })
  }

  var filtersObject = ko.observable({});

  self.addFilter = function(name, transaction){
    return function() {
      var filtersObjectTemp = filtersObject();
      var filter = filtersObjectTemp[name] = filters[name];
      filter.on = transaction;
      filtersObject(filtersObjectTemp);
    }
  }

  self.removeFilter = function(name) {
    return function() {
      var filtersObjectTemp = filtersObject();
      delete filtersObjectTemp[name];
      filtersObject(filtersObjectTemp);
    }
  }

  self.removeFilters = function(){
    filtersObject({});
  }

  self.filters = ko.computed(function(){
    return _.values(filtersObject());
  })

  self.filteredTransactions = ko.computed(function(){
    var sort = self.sortBy();
    var desc = self.desc();
    var filters = self.filters();
    var transactions = _.chain(self.transactions()).map(function(transaction){
      return new Transaction(settings.app, transaction);
    });

    filters.forEach(function(filter){
      transactions = transactions.filter(function(transaction){
        return filter.predicate(transaction, filter.on);
      })
    })

    if(sort) {
      transactions = transactions.sortBy(function(transaction){
        return transaction[sort];
      })

      if(desc) {
        transactions = transactions.reverse();
      }
    }

    return transactions.value();
  })
}

function BudgetController(settings){
  var self = this;
  var budgetMetaFile = "Budget.ymeta";
  var client = settings.client;
  var app = settings.app;

  self.budgets = ko.observableArray();
  self.budget = ko.observable();
  self.budgetDataFolder = ko.observable()
  self.device = ko.observable();
  self.loadingProgress = ko.observable(0);
  self.loadingMessages = ko.observableArray();
  self.errorMessage = app.errorMessage;

  self.budgetName = ko.computed(function(){
    return ((self.budget() || "").split("/")[1] || "").split("~")[0];
  })

  self.budgetMetaPath = ko.computed(function(){
    return [self.budget(), budgetMetaFile].join("/")
  })
  self.budgetDataPath = ko.computed(function(){
    return [self.budget(), self.budgetDataFolder()].join("/")
  })
  self.budgetDevicesPath = ko.computed(function(){
    return [self.budgetDataPath(), "devices"].join("/")
  })
  self.deviceFilePath = function(deviceFileName){
    return [self.budgetDevicesPath(), deviceFileName].join("/")
  }
  self.fullBudgetPath = ko.computed(function(){
    if(self.device()){
      return [self.budgetDataPath(), self.device().deviceGUID].join("/");
    }
  })
  self.fullBudgetSettings = ko.computed(function(){
    return [self.fullBudgetPath(), "budgetSettings.ybsettings"].join("/");
  })
  self.fullBudgetFile = ko.computed(function(){
    return [self.fullBudgetPath(), "Budget.yfull"].join("/");
  })

  self.loading = function(percent, message) {
    self.loadingProgress(percent);
    self.loadingMessages.unshift(message);
  }

  self.select = function(budget){
    self.budget(budget);
    self.device(null);

    self.loading(10, "Looking up where the YNAB data folder is ...");
    client.loadJson(self.budgetMetaPath()).then(function(data){
      self.loading(20, "Reading the YNAB data folder ...");
      self.budgetDataFolder(data.relativeDataFolderName);
      client.readDir(self.budgetDataPath()).then(function(){
        self.loading(40, "");
        client.readDir(self.budgetDevicesPath()).then(function(deviceFiles){
          self.loading(60, "Figuring out which device has the latest version ...");
          async.eachLimit(deviceFiles, 1, function(deviceFile, callback){
            if(self.device()) {
              callback()
            }else{
              var deviceFilePath = self.deviceFilePath(deviceFile);
              client.loadJson(deviceFilePath).then(function(device){
                if(device.hasFullKnowledge){
                  self.device(device);
                }
                callback();
              }).fail(function(){
                callback(true);
              })
            }
          }, function(err){
            if(!err) {
              self.loading(90, "Downloading the latest version of the data ...");
              client.loadJson(self.fullBudgetFile()).then(function(budget){
                self.loading(100);
                var categories = _.chain(budget.masterCategories).map(function(masterCategory){
                  return masterCategory.subCategories;
                }).flatten().filter(function(c) { return c; }).value();

                monthlyCategoryBudgets = _.chain(budget.monthlyBudgets).map(function(monthlyCategoryBudget){
                  _.each(monthlyCategoryBudget.monthlySubCategoryBudgets, function(monthlySubCategoryBudget){
                    monthlySubCategoryBudget.month = monthlyCategoryBudget.month;
                  });
                  return monthlyCategoryBudget.monthlySubCategoryBudgets;
                }).flatten().filter(function(c) { return c; }).value();

                app.payee.payees(budget.payees);
                app.category.categories(categories);
                app.monthlyCategoryBudget.monthlyCategoryBudgets(monthlyCategoryBudgets);

                app.transaction.transactions(budget.transactions.filter(function(transaction){
                  return !transaction.isTombstone;
                }).sort(function(a, b) {
                  return a.date.localeCompare(b.date);
                }))
              }).fail(function(){
                self.errorMessage("Error reading the budget file.")
              })
            } else {
              self.errorMessage("Error figuring out which devices has the latest version")
            }
          })
        }).fail(function(){
          self.errorMessage("Error reading " + self.budgetDevicesPath())
        })
      }).fail(function(){
        self.errorMessage("Error reading " + self.budgetDataPath())
      })
    }).fail(function(){
      self.errorMessage("Error loading " + self.budgetMetaPath())
    })
  }
}

function MonthlyCategoryBudget(app, monthlyCategoryBudget) {
  var self = this;
  self.month = monthlyCategoryBudget.month;
  self.categoryName = app.category.lookup(monthlyCategoryBudget.categoryId).name;
  self.categoryId = monthlyCategoryBudget.categoryId;
  self.budgeted = monthlyCategoryBudget.budgeted;
  self.outflows = _.reduce(app.transaction.transactions(), function(sum, transaction){
      var amount = 0;
      start = new Date(self.month);
      end = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
      // todo: include transactions split among multiple categories here
      // todo: include not-yet-approved scheduled transactions here
      // todo: use transaction filters instead of 'if'
      // todo: allow user to decide which categories to show here
      // todo: store dates as actual dates instead of strings
      // todo: remove everything that is not essential to monthly budgets

      transactionDate = new Date(transaction.date);

      if (transaction.categoryId === self.categoryId
          && transactionDate >= start
          && transactionDate < end
       )
        return sum + transaction.amount;
      else
          return sum;
  }, 0);

  self.balance = self.budgeted + self.outflows;

  // todo: make ontrack reflect how well you're sticking to the budget so far
  // todo: adjust for days in month

  var currentDay = new Date().getDate();

  var proratedBudget = self.budgeted / 31 * currentDay;

  self.ontrack = proratedBudget + self.outflows;
}

function Transaction(app, transaction) {
  var self = this;
  self.categoryName = app.category.lookup(transaction.categoryId).name;
  self.categoryId = transaction.categoryId;
  self.payeeId = transaction.payeeId;
  self.payeeName = app.payee.lookup(transaction.payeeId).name;
  self.date = transaction.date;
  self.memo = transaction.memo;
  self.amount = transaction.amount;
  self.subTransactions = (transaction.subTransactions || []).map(function(subTransaction){
    return {
      categoryName: app.category.lookup(subTransaction.categoryId).name,
      categoryId: subTransaction.categoryId
    };
  })

  self.baseObject = transaction;
}

function Filter(name, id, value, predicate) {
  var self = this;
  self.name = name;
  self.value = value;
  self.id = id;
  self.predicate = predicate;
}