function App(settings) {
  var self = this;
  var client = self.client = new Client(settings);
  var rootFile = ".ynabSettings.yroot";
  var appSettings = {
    client: client,
    app: self
  };
  self.numberFormat = '+0,0';
  self.errorMessage = ko.observable();
  self.budget = new BudgetController(appSettings);
  self.category = new CategoryController(appSettings);
  self.transaction = new TransactionController(appSettings);
  self.monthlyCategoryBudget = new MonthlyCategoryBudgetController(appSettings);
  self.monthlyBudget = new MonthlyBudgetController(appSettings);

  client.loadJson(rootFile).then(function(root) {
    console.log("loaded root file");
    self.budget.budgets(root.relativeKnownBudgets);
    if(self.budget.budgets().length > 1){
      self.budget.select(self.budget.budgets()[0])
    }
  }).fail(function() {
    self.errorMessage("Unable to load YNAB settings file (" + rootFile + "). Make sure you connect to a Dropbox account with that YNAB syncs with.");
  });
};

function CategoryController(settings) {
  var self = this;
  self.categories = ko.observableArray();

  var lookup = ko.computed(function() {
    return _.indexBy(self.categories(), 'entityId')
  })

  var specialLookup = {
    "Category/__ImmediateIncome__": {
      name: "Income"
    }
  }

  self.lookup = function(id) {
    return lookup()[id] || specialLookup[id] || {};
  }
}

function MonthlyBudgetController(settings) {
  var self = this;
  self.onTrack = ko.computed(function() {
    return _.reduce(settings.app.monthlyCategoryBudget.filteredMonthlyCategoryBudgets(), function(sum, catBudget) {
      sum += catBudget.onTrack;
      return sum;
    }, 0);
  });
  self.dailyBudget = ko.computed(function() {
    return _.reduce(settings.app.monthlyCategoryBudget.filteredMonthlyCategoryBudgets(), function(sum, catBudget) {
      sum += catBudget.dailyBudget;
      return sum;
    }, 0);
  });
}

function MonthlyCategoryBudgetController(settings) {
  var self = this;
  self.monthlyCategoryBudgets = ko.observableArray();
  self.filteredMonthlyCategoryBudgets = ko.computed(function() {

    // todo: remove duplicate new Date() logic
    // todo: get rid of the need for + 1 after budgetMonth but not curMonth

    var monthlyCategoryBudgets = _.chain(self.monthlyCategoryBudgets()).filter(function(monthlyCategoryBudget) {
      var categoryName = app.category.lookup(monthlyCategoryBudget.categoryId).name;
      var curMonth = new Date().getMonth();
      var curYear= new Date().getYear();
      var budgetParts = monthlyCategoryBudget.month.split('-');
      var budgetDate = new Date(budgetParts[0], budgetParts[1] - 1, budgetParts[2]); 
      var budgetMonth = budgetDate.getMonth();
      var budgetYear = budgetDate.getYear();
      return budgetYear === curYear && budgetMonth === curMonth && _.contains(settings.client.categoriesOfInterest, categoryName);
    }).map(function(monthlyCategoryBudget) {
      console.log("adding new monthlyCategoryBudget"+monthlyCategoryBudget.month);
      return new MonthlyCategoryBudget(settings.app, monthlyCategoryBudget);
    });

    return monthlyCategoryBudgets.value();
  });
}

function TransactionController(settings) {
  var self = this;
  self.transactions = ko.observableArray();

  self.filteredTransactions = ko.computed(function() {
    var transactions = _.chain(self.transactions()).map(function(transaction) {
      return new Transaction(settings.app, transaction);
    });

    return transactions.value();
  })
}

function BudgetController(settings) {
  var self = this;
  var budgetMetaFile = "Budget.ymeta";
  var client = settings.client;
  var app = settings.app;

  // todo: don't hard-code my own file names

  //self.budgetMetaPath = 'YNAB/Budget~9674B08A.ynab4/Budget.ymeta';
  self.budgetMetaPath = 'YNAB/USD~AA7FD686.ynab4/Budget.ymeta';
  self.relativeDataFolderName = 'data3-31CA3DB7';

  self.budgets = ko.observableArray();
  self.budget = ko.observable();
  self.budgetDataFolder = ko.observable()
  self.devices = ko.observableArray();
  self.deviceMostRecent = ko.observable();
  self.deviceWithBudgetFile = ko.observable();
  self.loadingProgress = ko.observable(0);
  self.loadingMessages = ko.observableArray();
  self.errorMessage = app.errorMessage;

  self.budgetName = ko.computed(function() {
    return ((self.budget() || "").split("/")[1] || "").split("~")[0];
  });

  self.budgetDataPath = ko.computed(function() {
    return [self.budget(), self.budgetDataFolder()].join("/");
  });

  self.budgetDevicesPath = ko.computed(function() {
    return [self.budgetDataPath(), "devices"].join("/")
  });

  self.deviceFilePath = function(deviceFileName) {
    //return [self.budgetDevicesPath(), deviceFileName].join("/")
    return deviceFileName;
  };

  self.fullBudgetPath = ko.computed(function() {
    if (self.deviceWithBudgetFile()) {
      return [self.budgetDataPath(), self.deviceWithBudgetFile().deviceGUID].join("/");
    }
  });

  self.fullBudgetSettings = ko.computed(function() {
    return [self.fullBudgetPath(), "budgetSettings.ybsettings"].join("/");
  });

  self.fullBudgetFile = ko.computed(function() {
    return [self.fullBudgetPath(), "Budget.yfull"].join("/");
  });

  self.loading = function(percent, message) {
    self.loadingProgress(percent);
    self.loadingMessages.unshift(message);
  }

  self.select = function(budget) {
    self.budget(budget);
    self.deviceWithBudgetFile(null);
    self.deviceMostRecent(null);

    self.loading(10, "Looking up where the YNAB data folder is ...");
    client.loadJson(self.budgetMetaPath).then(function(data) {
      self.loading(20, "Reading the YNAB data folder ...");
      self.budgetDataFolder(self.relativeDataFolderName);
      client.readDir(self.budgetDataPath()).then(function() {
        self.loading(40, "");
        client.readDir(self.budgetDevicesPath()).then(function(deviceFiles) {
          self.loading(60, "Figuring out which device has the latest version ...");

          // todo: diff the latest version if it's mobile (doesn't have full knowledge)
          // device files are of form [something].ydevice
          deviceFiles = _.filter(deviceFiles, function(f) {
            return /.+\.ydevice$/i.test(f)
          });

          async.eachLimit(deviceFiles, 1, function(deviceFile, callback) {
            if (self.deviceWithBudgetFile()) {
              callback()
            } else {
              var deviceFilePath = self.deviceFilePath(deviceFile);
              client.loadJson(deviceFilePath).then(function(device) {
                self.devices.push(device);
                if (self.devices().length === deviceFiles.length) {

                  // find device that has most recent knowledge
                  // if you most recently edited with your cell phone, this will be your cell phone
                  // todo: refactor to remove duplication between this block and the next
                  var deviceMostRecent = _.max(self.devices(), function(device) {
                    var versionsKnown = device.knowledge.split(',');
                    var versionsKnownSum = _.reduce(versionsKnown, function(sum, versionKnown) {
                      var versionNum = parseInt(versionKnown.substr(versionKnown.indexOf('-') + 1));
                      return sum += versionNum;
                    }, 0);
                    return versionsKnownSum;
                  });

                  self.deviceMostRecent(deviceMostRecent);

                  // find device that has most recent knowledge that also has the full budget file
                  // if you most recently edited with your cell phone, this will the device BEFORE your cell phone
                  var deviceWithBudgetFile = _.max(self.devices(), function(device) {
                    if (!device.hasFullKnowledge) return;
                    var versionsKnown = device.knowledge.split(',');
                    var versionsKnownSum = _.reduce(versionsKnown, function(sum, versionKnown) {
                      var versionNum = parseInt(versionKnown.substr(versionKnown.indexOf('-') + 1));
                      return sum += versionNum;
                    }, 0);
                    return versionsKnownSum;
                  });

                  self.deviceWithBudgetFile(deviceWithBudgetFile);
                }
                callback();
              }).fail(function() {
                callback(true);
              })
            }
          }, function(err) {
            if (!err) {
              self.loading(90, "Downloading the latest version of the data ...");
              client.loadJson(self.fullBudgetFile()).then(function(budget) {
                self.loading(100);
                var categories = _.chain(budget.masterCategories).map(function(masterCategory) {
                  return masterCategory.subCategories;
                }).flatten().filter(function(c) {
                  return c;
                }).value();

                monthlyCategoryBudgets = _.chain(budget.monthlyBudgets).map(function(monthlyCategoryBudget) {
                  _.each(monthlyCategoryBudget.monthlySubCategoryBudgets, function(monthlySubCategoryBudget) {
                    monthlySubCategoryBudget.month = monthlyCategoryBudget.month;
                  });
                  return monthlyCategoryBudget.monthlySubCategoryBudgets;
                }).flatten().filter(function(c) {
                  return c;
                }).value();

                app.category.categories(categories);
                app.monthlyCategoryBudget.monthlyCategoryBudgets(monthlyCategoryBudgets);

                app.transaction.transactions(budget.transactions.filter(function(transaction) {
                  return !transaction.isTombstone;
                }).sort(function(a, b) {
                  return a.date.localeCompare(b.date);
                }))
              }).fail(function() {
                self.errorMessage("Error reading the budget file.")
              })
            } else {
              self.errorMessage("Error figuring out which devices has the latest version")
            }
          })
        }).fail(function() {
          self.errorMessage("Error reading " + self.budgetDevicesPath())
        })
      }).fail(function() {
        self.errorMessage("Error reading " + self.budgetDataPath())
      })
    }).fail(function() {
      self.errorMessage("Error loading " + self.budgetMetaPath)
    })
  }
}

function MonthlyCategoryBudget(app, monthlyCategoryBudget) {
  var self = this;
  self.month = new Date(monthlyCategoryBudget.month);
  self.categoryName = app.category.lookup(monthlyCategoryBudget.categoryId).name;
  self.categoryId = monthlyCategoryBudget.categoryId;
  self.budgeted = monthlyCategoryBudget.budgeted;

  self.outflows = _.reduce(app.transaction.transactions(), function(sum, transaction) {

    // todo: include not-yet-approved scheduled transactions here

    var start = self.month;
    var end = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
    var transactionDate = new Date(transaction.date);

    if (transactionDate < start || transactionDate >= end)
      return sum;

    if (transaction.categoryId === self.categoryId)
      sum += transaction.amount;

    var subSum = _.reduce((transaction.subTransactions || []), function(subSum, subTransaction) {
      if (subTransaction.categoryId === self.categoryId){
        subSum += subTransaction.amount;
        console.log("categoryId:" + subTransaction.categoryId);
      }

      return subSum;

    }, 0);

    return sum + subSum;

  }, 0);

  self.balance = self.budgeted + self.outflows;

  var currentDate = new Date();
  var currentDay = currentDate.getDate()
  var daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

  self.dailyBudget = self.budgeted / daysInMonth;

  var proratedBudget = self.dailyBudget * currentDay;

  self.onTrack = proratedBudget + self.outflows; // outflows is negative, don't subtract it
}

function Transaction(app, transaction) {
  var self = this;
  self.categoryName = app.category.lookup(transaction.categoryId).name;
  self.categoryId = transaction.categoryId;
  self.date = new Date(transaction.date);
  self.memo = transaction.memo;
  self.amount = transaction.amount;
  self.subTransactions = (transaction.subTransactions || []).map(function(subTransaction) {
    return {
      categoryName: app.category.lookup(subTransaction.categoryId).name,
      categoryId: subTransaction.categoryId,
      amount: subTransaction.amount
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
