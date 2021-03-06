// ADAPTED FROM FROZEMAN: https://gist.github.com/frozeman/88a3e47679dd74242cab
/*
These two functions provide a simple extra minimongo functionality to add and remove documents in bulk,
without unnecessary re-renders.

The process is simple. It will add the documents to the collections "_map" and only the last item will be inserted properly
to cause reactive dependencies to re-run.
*/
 
 
DumbModels = {};

/**
 * Decompress compressed collection fields
 */
DumbModels.decompress = function(collection,documents){
    "use strict";
    var newDocuments = [], itemUncomp;
    if(collection) {
        //console.log('decompressing ' + collection.name + '...');
        _.each(documents, function(item){
            if(_.isObject(item)) {
                compressedFields.forEach(function(field){
                    "use strict";
                    if(item[field]){
                        itemUncomp = LZString.decompress(item[field]);
                        item[field] = itemUncomp || item[field];
                    }
                });
                newDocuments.push(item);
            }
        });
    }

    return documents;
};

/*
 Updates documents in bulk.
 */
DumbModels.updateBulk = function(collection, documents){
    var updQuery = {},oldDocument = {}, prop, companies = [];

    //console.log('in DumbModels.updateBulk. Collection: ' + collection.name + ', documents: ' + JSON.stringify(documents));

    if(documents && !_.isArray(documents)){
        documents = [documents];
    }

    if(collection && documents.length > 0) {
        documents.forEach(function(item,i){
            if(_.isObject(item)) {
                oldDocument = collection.findOne(item._id);
                updQuery.$set = {};
                if(oldDocument){
                    for(prop in item){
                        if(item.hasOwnProperty(prop)){
                            if(_.isObject(item[prop])){
                                if(JSON.stringify(oldDocument[prop]) !== JSON.stringify(item[prop])) {
                                    updQuery.$set[prop] = item[prop];
                                }
                            } else {
                                if(!_.isEqual(oldDocument[prop],item[prop])) {
                                    updQuery.$set[prop] = item[prop];
                                }
                            }

                        }
                    }
                }

                if(!_.isEmpty(updQuery.$set)){
                    collection.update(item._id,updQuery);
                }

            }
        });
    }
};

    /*
Inserts documents in bulk.
*/
DumbModels.insertBulk = function(collection, documents){

    if(collection) {
        var last = _.last(documents);
        _.each(documents, function(item){
            if(_.isObject(item)) {
                if (item._id === last._id){
                    collection.insert(item);
                }
                else {
                    collection._collection._docs._map[item._id] = item;
                }
            }
        });
    }
};
 
/*
Removes documents in bulk.
*/
DumbModels.removeBulk = function(collection, ids){
    var _this = this;
    var _id;
 
    if (collection) {
        var lastId = _.last(ids);
        _.each(ids, function(id){
            if (id === lastId){
                collection.remove(id);
            }
            else {
                delete collection._collection._docs._map[id];
            }
        });
    }
};

/*
Removes all documents in a collection.
*/
DumbModels.removeAll = function(collection){
    var _this = this;
 
    if (collection) {
        var exampleId = Object.keys(collection._collection._docs._map)[0];
        var newObj = {};
        if (exampleId) newObj[exampleId] = collection._collection._docs._map[exampleId];
        collection._collection._docs._map = newObj;
        if (exampleId) collection.remove({_id: exampleId});
    }
};