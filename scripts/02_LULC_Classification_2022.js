// =====================================================
// PROJECT: Land Use / Land Cover Classification
// STUDY AREA: Dar es Salaam, Tanzania
// YEAR: 2022
// DATA: Landsat 8 Surface Reflectance
// METHOD: Random Forest Classification
//
// Training samples were collected through visual
// interpretation of Landsat imagery, Google Satellite
// basemap, Sentinel-2 imagery and ESA WorldCover
// reference data.
//
// CLASSES:
// 0 = Built-up
// 1 = Tree Cover
// 2 = Water Bodies
// 3 = Barren Land
// 4 = Grassland
// 5 = Shrubland
// 6 = Cropland
// =====================================================

// =====================================================
// SECTION 1: STUDY AREA AND REFERENCE DATA
// =====================================================

// Sentinel-2 composite used as auxiliary reference
// during training sample collection

var image = s2
.filterBounds(Dar)
.filterDate('2022-01-01', '2022-12-31')
.filterMetadata('CLOUDY_PIXEL_PERCENTAGE', 'less_than', 5);

var sentinel2 = image.mean().clip(Dar);

// ESA WorldCover used as auxiliary reference
var lc = ESA.filterBounds(Dar).first().clip(Dar);

Map.centerObject(Dar, 10);

Map.addLayer(Dar, {}, 'Study Area');
Map.addLayer(sentinel2, {}, 'Sentinel-2 Reference', false);
Map.addLayer(lc, {}, 'ESA WorldCover', false);

// =====================================================
// SECTION 2: LANDSAT 8 COMPOSITE
// =====================================================

var landsatComposite2022 = L8surf
.filterBounds(Dar)
.filterDate('2022-01-01', '2022-12-31')
.filterMetadata('CLOUD_COVER', 'less_than', 10)
.mean()
.clip(Dar);

Map.addLayer(
landsatComposite2022,
{
bands:['SR_B4','SR_B3','SR_B2'],
min:0,
max:15000
},
'Landsat 8 RGB',
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

// Spectral indices

var ndvi = landsatComposite2022
.normalizedDifference(['SR_B5','SR_B4'])
.rename('NDVI');

var ndwi = landsatComposite2022
.normalizedDifference(['SR_B3','SR_B5'])
.rename('NDWI');

var ndbi = landsatComposite2022
.normalizedDifference(['SR_B6','SR_B5'])
.rename('NDBI');

var features = landsatComposite2022
.addBands(ndvi)
.addBands(ndwi)
.addBands(ndbi);

var predictorBands = [
'SR_B2',
'SR_B3',
'SR_B4',
'SR_B5',
'SR_B6',
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
'#ca36d6', // Built-up
'#0e5e08', // Tree Cover
'#29a3e6', // Water Bodies
'#ff0000', // Barren Land
'#23fff2', // Grassland
'#c2b52e', // Shrubland
'#16ff45'  // Cropland
];

Map.addLayer(
classified,
{
min:0,
max:6,
palette:palette
},
'LULC 2022'
);

// =====================================================
// SECTION 8: ACCURACY ASSESSMENT
// =====================================================

var validation = features
.select(predictorBands)
.sampleRegions({
collection: testSet,
properties:['Class'],
scale:30
});

validation = validation.classify(classifier);

var validationAccuracy =
validation.errorMatrix(
'Class',
'classification'
);

print(
'Validation error matrix',
validationAccuracy
);

print(
'Validation accuracy',
validationAccuracy.accuracy()
);

print(
'Kappa statistic',
validationAccuracy.kappa()
);

print(
'Producer Accuracy',
validationAccuracy.producersAccuracy()
);

// =====================================================
// SECTION 9: AREA STATISTICS
// =====================================================

var classArea =
ee.Image.pixelArea()
.addBands(classified)
.divide(1e6)
.reduceRegion({
reducer: ee.Reducer.sum().group(1),
geometry: Dar,
scale: 30,
bestEffort: true
});

print(
classArea,
'Class area in sq km'
);

// =====================================================
// SECTION 10: VARIABLE IMPORTANCE
// =====================================================

var importance = ee.Dictionary(
classifier.explain().get('importance')
);

print(
'Variable Importance',
importance
);

// =====================================================
// SECTION 11: EXPORT RESULTS
// =====================================================

// Export classified map to Google Drive

Export.image.toDrive({
image: classified,
description: 'LULC_2022',
folder: 'Objective_1_Urban_Heat_Island',
fileNamePrefix: 'LULC_2022',
region: Dar,
scale: 30,
maxPixels: 1e13
});

// Export classified map to GEE Assets

Export.image.toAsset({
image: classified,
description: 'LULC_2022',
assetId: 'LULC_2022',
region: Dar,
scale: 30,
maxPixels: 1e13
});

// =====================================================
// EXPORT CLASS AREA STATISTICS
// =====================================================

var classNames = ee.Dictionary({
0: 'Built-up',
1: 'Tree Cover',
2: 'Water Bodies',
3: 'Barren Land',
4: 'Grassland',
5: 'Shrubland',
6: 'Cropland'
});

var areaList =
ee.List(classArea.get('groups'));

var areaTable =
ee.FeatureCollection(
areaList.map(function(item){

  item = ee.Dictionary(item);

  var classId =
    ee.Number(item.get('group'));

  return ee.Feature(null,{
    'Class_ID': classId,
    'Class_Name': classNames.get(
      classId.format()
    ),
    'Area_km2': item.get('sum')
  });

})

);

Export.table.toDrive({
collection: areaTable,
description: 'LULC_2022_Class_Areas',
fileFormat: 'CSV'
});
