// PROJECT: Land Use / Land Cover Classification (2009)
// STUDY AREA: Dar es Salaam, Tanzania
// DATA: Landsat 5 Surface Reflectance
// METHOD: Random Forest Classification
// CLASSES:
// 0 = Built-up
// 1 = Tree Cover
// 2 = Water Bodies
// 3 = Barren Land
// 4 = Grassland
// 5 = Shrubland
// 6 = Cropland

// =====================================================
// SECTION 1: STUDY AREA AND REFERENCE DATA
// =====================================================

// ESA WorldCover (used only as visual reference)
var lc = ESA.filterBounds(Dar).first().clip(Dar);

Map.centerObject(Dar, 10);

Map.addLayer(Dar, {}, 'Study Area');
Map.addLayer(lc, {}, 'ESA WorldCover', false);

// =====================================================
// SECTION 2: LANDSAT 5 COMPOSITE
// =====================================================

var path = 166;
var row = 65;

var Land5 = L5surf
  .filter(ee.Filter.eq('WRS_PATH', path))
  .filter(ee.Filter.eq('WRS_ROW', row))
  .filterDate('2009-06-21', '2009-07-07')
  .filterMetadata('CLOUD_COVER', 'less_than', 20)
  .median();

var Land5_Dar = Land5.clip(Dar);

Map.addLayer(
  Land5_Dar,
  {
    bands:['SR_B3','SR_B2','SR_B1'],
    min:0,
    max:15000
  },
  'Landsat 5 RGB',
  false
);

// =====================================================
// SECTION 3: TRAINING DATA
// =====================================================

var sample = built_up
  .merge(tree_cover)
  .merge(waterbodies)
  .merge(barren_land)
  .merge(grassland)
  .merge(shrubland)
  .merge(cropland);

print('Training Samples', sample);

print(
  'Class Distribution',
  sample.aggregate_histogram('Class')
);

// =====================================================
// SECTION 4: FEATURE ENGINEERING
// =====================================================

// Spectral Indices

var ndvi = Land5_Dar
  .normalizedDifference(['SR_B4','SR_B3'])
  .rename('NDVI');

var ndwi = Land5_Dar
  .normalizedDifference(['SR_B2','SR_B4'])
  .rename('NDWI');

var ndbi = Land5_Dar
  .normalizedDifference(['SR_B5','SR_B4'])
  .rename('NDBI');

var features = Land5_Dar
  .addBands(ndvi)
  .addBands(ndwi)
  .addBands(ndbi);

var predictorBands = [
  'SR_B1',
  'SR_B2',
  'SR_B3',
  'SR_B4',
  'SR_B5',
  'SR_B7',
  'NDVI',
  'NDWI',
  'NDBI'
];

// =====================================================
// SECTION 5: TRAIN / TEST SPLIT
// =====================================================

var dataset = sample.randomColumn();

var trainSet =
  dataset.filter(ee.Filter.lt('random',0.8));

var testSet =
  dataset.filter(ee.Filter.gte('random',0.8));
  
// =====================================================
// SECTION 6: RANDOM FOREST CLASSIFICATION
// =====================================================

var training = features
  .select(predictorBands)
  .sampleRegions({
    collection: trainSet,
    properties:['Class'],
    scale:30
  });

var classifier =
  ee.Classifier.smileRandomForest(200)
  .train(training,'Class');

var classified =
  features.classify(classifier);
  
// =====================================================
// SECTION 7: VISUALIZATION
// =====================================================

var palette = [
  '#ca36d6',
  '#0e5e08',
  '#29a3e6',
  '#ff0000',
  '#23fff2',
  '#c2b52e',
  '#16ff45'
];

Map.addLayer(
  classified,
  {
    min:0,
    max:6,
    palette:palette
  },
  'LULC 2009'
);

// =====================================================
// SECTION 8: ACCURACY ASSESSMENT
// =====================================================
var validation = features
  .select(predictorBands)
  .sampleRegions({
    collection: testSet ,  
    properties:['Class'] , 
    scale:30
  });

validation = validation.classify(classifier)
var validationAccuracy = validation.errorMatrix('Class','classification')
print('Validation error matrix', validationAccuracy)
print('Validation accuracy', validationAccuracy.accuracy())
print('Kappa statistic', validationAccuracy.kappa())
print('Producer Accuracy', validationAccuracy.producersAccuracy());

// =====================================================
// SECTION 9: AREA STATISTICS
// =====================================================

var classArea = ee.Image.pixelArea().addBands(classified).divide(1e6)
                .reduceRegion({
                  reducer: ee.Reducer.sum().group(1),
                  geometry: Dar,
                  scale: 30,
                  bestEffort: true
                })

print(classArea, 'Class area in sq km')

// =====================================================
// SECTION 10: VARIABLE IMPORTANCE
// =====================================================

var importance = ee.Dictionary(
  classifier.explain().get('importance')
);

print('Variable Importance', importance);

// Check class balance
print(
  sample.aggregate_histogram('Class')
);

// =====================================================
// SECTION 11: EXPORT RESULTS
// =====================================================

// Export result to drive
Export.image.toDrive({
  image: classified, 
  description: 'LULC_2009', 
  folder: 'Objective_1_Urban_Heat_Island', 
  fileNamePrefix: 'LULC_2009', 
  region: Dar, 
  scale: 30, 
  maxPixels: 1e13, 
})

// Export result to drive
Export.image.toAsset({
  image: classified,
  description: 'LULC_2009',
  assetId: 'LULC_2009',
  region: Dar,
  scale: 30,
  maxPixels: 1e13
})

// Export class statistics
var classNames = ee.Dictionary({
  0: 'Built-up',
  1: 'Tree Cover',
  2: 'Water Bodies',
  3: 'Barren Land',
  4: 'Grassland',
  5: 'Shrubland',
  6: 'Cropland'
});

var areaList = ee.List(classArea.get('groups'));
var areaTable = ee.FeatureCollection(
  areaList.map(function(item) {

    item = ee.Dictionary(item);

    var classId = ee.Number(item.get('group'));

    return ee.Feature(null, {
      'Class_ID': classId,
      'Class_Name': classNames.get(classId.format()),
      'Area_km2': item.get('sum')
    });

  })
);

Export.table.toDrive({
  collection: areaTable,
  description: 'LULC_2009_Class_Areas',
  fileFormat: 'CSV'
});
