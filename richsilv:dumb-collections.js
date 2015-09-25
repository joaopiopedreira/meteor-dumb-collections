
if (Meteor.isServer) {

	var collections = {};

	var transform = function(doc){
		var prop;
		for(prop in doc){
			if(doc.hasOwnProperty(prop) && _.contains(compressedFields,prop)){
				if(doc[prop]){
					var comp = LZString.compress(doc[prop]);
					doc[prop] = comp || doc[prop];
				}
			}
		}
		return doc;
	};


	DumbCollection = function(name, options) {

		var newCollection = new Mongo.Collection(name, options),
			_this = this;

		collections[name] = newCollection;

		return newCollection;

	};

	Meteor.methods({

		dumbCollectionGetUpdated: function(existing, name, query, options) {

			this.unblock();

			return collections[name].find(_.extend(query || {}, {
				__dumbVersion: {
					$nin: existing
				}
			}), options /*{transform:transform}*/ || {}).fetch();

		},

		dumbCollectionGetNew: function(existing, name, query, options) {

			this.unblock();

			var docs = collections[name].find(_.extend(query || {}, {
				_id: {
					$nin: existing
				}
			}), options /*{transform:transform}*/ || {}).fetch();

			return docs;

		},

		dumbCollectionGetRemoved: function(existing, name, query) {

			this.unblock();

			var currentIds = {};

			collections[name].find(query || {}, {
				fields: {
					_id: true
				}
			}).forEach(function(doc) {
				currentIds[doc._id] = true;
			});

			var missingIds = existing.filter(function(docId){
			    return !(docId in currentIds);
			});

			return missingIds || [];

		}

	});

} else if (Meteor.isClient) {

	DumbCollection = function(name, options) {

		var coll = new Mongo.Collection(null, options);
		var existingDocs;

		coll.name = name;
		coll.syncing = false;
		coll._readyFlag = new ReactiveVar(false);
		coll._syncFlag = new ReactiveVar(false);

		//var existingDocs = amplify.store('dumbCollection_' + name) || [];
		localforage.getItem('dumbCollection_' + name).then(function(value) {
			existingDocs = value || [];
			DumbModels.insertBulk(coll, existingDocs);
			coll._readyFlag.set(true);
			console.log("Dumb Collection " + name + " seeded with " + existingDocs.length.toString() + " docs from local storage.");
		});


		coll.sync = function(options) {

			options = options || {};

			if (coll.syncing) throw new Meteor.Error('already_syncing', 'Cannot sync whilst already syncing');

			var jobsComplete = {
					remove: options.retain,
					insert: options.reject,
					update:false
				},
				completionDep = new Deps.Dependency(),
				results = {},
				currentIds = [],
				currentDumbVersionIds = [];

			coll._syncFlag.set(false);

			Tracker.autorun(function(outerComp) {

				if (coll.ready() && !coll.syncing) {

					coll.syncing = true;

					currentIds = _.pluck(coll.find({}, {
						reactive: false,
						fields: {
							_id: 1
						}
					}).fetch(), '_id');

					currentDumbVersionIds = _.uniq(_.pluck(coll.find({}, {
						reactive: false,
						fields: {
							__dumbVersion: 1
						}
					}).fetch(), '__dumbVersion'));

					if (!options.retain) {
						Meteor.call('dumbCollectionGetRemoved', currentIds, coll.name, options.query, function(err, res) {
							if(err) throw new Meteor.Error(500,'problems invoking dumbCollectionGetRemoved on the server');
							DumbModels.removeBulk(coll, res);
							results.removed = res;
							jobsComplete.remove = true;
							completionDep.changed();
							options.removalCallback && options.removalCallback.call(coll, removed);
						});
					} else jobsComplete.remove = true;

					if (!options.reject) {
						Meteor.call('dumbCollectionGetNew', currentIds, coll.name, options.query, options.options, function(err, res) {
							if(err) throw new Meteor.Error(500,'problems invoking dumbCollectionGetNew on the server');
							//res = MiniMax.maxify(res);
							results.inserted = res;
							//var resCompressed = JSON.stringify(res).length;
							//res = DumbModels.decompress(coll,res);
							//var resUncompressed = JSON.stringify(res).length;
							//console.log('Compressed: %d, Uncompressed: %d, Compression ratio: %s',resCompressed,resUncompressed, Number(((resUncompressed - resCompressed) / resUncompressed)).toFixed(2));
							DumbModels.insertBulk(coll, res);
							jobsComplete.insert = true;
							completionDep.changed();
							options.insertionCallback && options.insertionCallback.call(coll, res);
						});
					} else jobsComplete.insert = true;
  4
					Meteor.call('dumbCollectionGetUpdated', currentDumbVersionIds, coll.name, options.query, options.options, function(err, res) {
						if(err) throw new Meteor.Error(500,'problems invoking dumbCollectionGetUpdated on the server');
						res = res || [];
						results.updated = res;
						//res = DumbModels.decompress(coll,res);
						DumbModels.updateBulk(coll, res);
						jobsComplete.update = true;
						completionDep.changed();
						options.updateCallback && options.updateCallback.call(coll, res);
					});

					Tracker.autorun(function(innerComp) {

						completionDep.depend();

						if (jobsComplete.remove && jobsComplete.insert && jobsComplete.update) {

							innerComp.stop();
							outerComp.stop();
							coll._syncFlag.set(true);
							coll.syncing = false;

							// Use @raix MiniMax
							var syncedCollection = coll.find().fetch();
							try {
								//amplify.store('dumbCollection_' + coll.name, syncedCollection);
								localforage.setItem('dumbCollection_' + coll.name, syncedCollection).then(function(err, value) {
									if(value)
										console.log('Stored ' + value.length + ' items of ' + coll.name + 'in localforage');
								});							}
							catch (e) {
								console.log("Collection cannot be stored in localforage." + JSON.stringify(e));
								options.failCallback && options.failCallback.call(coll, e);
							}
							finally {
								console.log("Dumb Collection " + coll.name + " now has " + syncedCollection.length + " documents stored locally.");
								options.syncCallback && options.syncCallback.call(coll, results);
							}
						}

					});

				}

			});

		};

		coll.clear = function(reactive) {

			DumbModels.removeAll(coll);

			//amplify.store('dumbCollection_' + coll.name, []);
			localforage.setItem('dumbCollection_' + coll.name, []).then(function(err, value) {
				console.log('Cleared all items of ' + coll.name + ' from localforage');
			});

			if (reactive) {
				coll._syncFlag.set(false);
			} else {
				coll._syncFlag.curValue = false;
			}
		};

		coll.ready = function() {

			return coll._readyFlag.get();

		};

		coll.synced = function() {

			return coll._syncFlag.get();

		};

		coll.ironRouterReady = function() {

			return {
				ready: function() {
					return coll._syncFlag.get();
				}
			}

		};

		return coll;

	}

}
