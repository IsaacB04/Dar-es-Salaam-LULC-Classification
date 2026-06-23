// =====================================================
// PROJECT: Land Use / Land Cover Change Detection
// STUDY AREA: Dar es Salaam, Tanzania
// PERIOD: 2009 - 2022
// METHOD: Post-classification comparison
// =====================================================

// =====================================================
// SECTION 1: INPUT DATA
// =====================================================

var lulc_palette = ['#ca36d6','#0e5e08','#29a3e6','#ff0000','#23fff2','#c2b52e', '#16ff45'];
var lulc_values = [0,1,2,3,4,5,6];
var lulc_names = ['built_up','tree_cover','waterbodies','barren_land','grassland','shrubland','cropland'];

// ---- LULC images for years ----
var lulcList = [
  { year: 2009, image: lulc_2009 },
  { year: 2022, image: lulc_2022 }
];

Map.centerObject(Dar,10);

Map.addLayer(
  lulc_2009,
  {
    min:0,
    max:6,
    palette:lulc_palette
  },
  'LULC 2009'
);

Map.addLayer(
  lulc_2022,
  {
    min:0,
    max:6,
    palette:lulc_palette
  },
  'LULC 2022'
);

// =====================================================
// SECTION 2:  CHANGE MAP
// =====================================================

var changeValues = [], changeNames = [];
var changeMap = ee.Image(0);

lulc_values.forEach(function(v1, i1){
  lulc_values.forEach(function(v2, i2){
    var changeValue = v1 * 1e2 + v2;
    changeValues.push(changeValue);
    changeNames.push(lulc_names[i1] + ' -> ' + lulc_names[i2]);
    changeMap = changeMap.where(lulcList[0].image.eq(v1).and(lulcList[1].image.eq(v2)), changeValue);
  });
});

changeMap = changeMap.selfMask();
Map.addLayer(changeMap, {min:101, max:1010, palette: lulc_palette}, 'LULC Change Map');

var changeDict = ee.Dictionary.fromLists(
  changeValues.map(String),
  changeNames
);
print('Land cover change values', changeDict);

print('changeValues', changeValues);
print('changeValues as strings', changeValues.map(String));

// =====================================================
// SECTION 3: TRANSITION AREA CALCULATIONS
// =====================================================

function areaByChange(changeMap) {
  var area = ee.Image.pixelArea().addBands(changeMap).divide(1e6)
      .reduceRegion({
        reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'changeValue'}),
        geometry: Dar,
        scale: 30,
        bestEffort: true
      });
  var list = ee.List(ee.Dictionary(area.get('groups')));
  var fc = ee.FeatureCollection(list.map(function(item){
    item = ee.Dictionary(item);
    return ee.Feature(null, {
      'changeValue': item.get('changeValue'),
      'area_km2': item.get('sum')
    });
  }));
  // Add descriptive names
  return fc.map(function(f){
    var v = f.get('changeValue');
    return f.set('changeName', changeDict.get(v));
  });
}
var changeAreaWithNames = areaByChange(changeMap);
print('Land Cover Change Areas:', changeAreaWithNames);

// =====================================================
// SECTION 4: TRANSITION MATRIX
// =====================================================

var transition = lulc_2009
  .multiply(10)
  .add(lulc_2022);
  
var transitionArea = ee.Image.pixelArea()
  .addBands(transition)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'transition'
    }),
    geometry: Dar,
    scale: 30,
    bestEffort: true
  });

print('Transition Areas', transitionArea);

var transitionList =
  ee.List(transitionArea.get('groups'));

var transitionTable =
  ee.FeatureCollection(
    transitionList.map(function(item){

      item = ee.Dictionary(item);

      var code =
        ee.Number(item.get('transition'));

      var fromClass =
        code.divide(10).floor();

      var toClass =
        code.mod(10);

      return ee.Feature(null,{
        'From': fromClass,
        'To': toClass,
        'Area_km2':
          ee.Number(item.get('sum'))
          .divide(1e6)
      });

    })
  );

print(
  'Transition Table',
  transitionTable
);

var classNames = ee.Dictionary({
  0:'Built-up',
  1:'Tree Cover',
  2:'Water Bodies',
  3:'Barren Land',
  4:'Grassland',
  5:'Shrubland',
  6:'Cropland'
});

transitionTable =
  transitionTable.map(function(f){

    var fromClass =
      ee.Number(f.get('From')).int();

    var toClass =
      ee.Number(f.get('To')).int();

    return f
      .set(
        'From_Name',
        classNames.get(fromClass.format('%d'))
      )
      .set(
        'To_Name',
        classNames.get(toClass.format('%d'))
      );

  });

print(
  'Transition Matrix Table',
  transitionTable
);

// =====================================================
// SECTION 5: GAIN / LOSS ANALYSIS
// =====================================================

var classNames = lulc_names

var gainLossTable = ee.FeatureCollection(

  ee.List.sequence(0,6).map(function(classId){

    classId = ee.Number(classId);

    // Area in 2009

    var area2009 = ee.Image.pixelArea()
      .updateMask(lulc_2009.eq(classId))
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: Dar,
        scale: 30,
        bestEffort: true
      })
      .get('area');

    // Area in 2022

    var area2022 = ee.Image.pixelArea()
      .updateMask(lulc_2022.eq(classId))
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: Dar,
        scale: 30,
        bestEffort: true
      })
      .get('area');

    // Stable area

    var stableArea = ee.Image.pixelArea()
      .updateMask(
        lulc_2009.eq(classId)
        .and(
          lulc_2022.eq(classId)
        )
      )
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: Dar,
        scale: 30,
        bestEffort: true
      })
      .get('area');

    area2009 = ee.Number(area2009).divide(1e6);
    area2022 = ee.Number(area2022).divide(1e6);
    stableArea = ee.Number(stableArea).divide(1e6);

    var gain =
      area2022.subtract(stableArea);

    var loss =
      area2009.subtract(stableArea);

    var netChange =
      gain.subtract(loss);

    return ee.Feature(null, {

      'Class_ID': classId,

      'Class_Name':
        ee.List(classNames)
          .get(classId),

      'Area_2009_km2':
        area2009,

      'Area_2022_km2':
        area2022,

      'Stable_km2':
        stableArea,

      'Gain_km2':
        gain,

      'Loss_km2':
        loss,

      'Net_Change_km2':
        netChange

    });

  })

);

print(
  'Gain / Loss Statistics',
  gainLossTable
);

// =====================================================
// SECTION 6: CHANGE SUMMARY
// =====================================================

// Stable pixels
var stablePixels = lulc_2009.eq(lulc_2022);

// Changed pixels
var changedPixels = lulc_2009.neq(lulc_2022);

// Stable area (km²)
var stableArea = ee.Number(
  ee.Image.pixelArea()
    .updateMask(stablePixels)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: Dar,
      scale: 30,
      bestEffort: true
    })
    .get('area')
).divide(1e6);

// Changed area (km²)
var changedArea = ee.Number(
  ee.Image.pixelArea()
    .updateMask(changedPixels)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: Dar,
      scale: 30,
      bestEffort: true
    })
    .get('area')
).divide(1e6);

// Total study area (km²)
var totalArea = stableArea.add(changedArea);

// Percentages
var stablePercent =
  stableArea.divide(totalArea)
  .multiply(100);

var changedPercent =
  changedArea.divide(totalArea)
  .multiply(100);

// Summary table

var changeSummary = ee.FeatureCollection([
  
  ee.Feature(null, {

    'Total_Area_km2': totalArea,

    'Stable_Area_km2': stableArea,

    'Changed_Area_km2': changedArea,

    'Stable_Percent':
      stablePercent,

    'Changed_Percent':
      changedPercent

  })

]);

print(
  'Change Summary',
  changeSummary
);

// =====================================================
// SECTION 7: EXPORTS
// =====================================================

// Transition areas
Export.table.toDrive({
  collection: transitionArea,
  description: 'Transition_Areas_2009_2022',
  fileFormat: 'CSV'
});

// Transition table
Export.table.toDrive({
  collection: transitionTable,
  description: 'Transition_Matrix_2009_2022',
  fileFormat: 'CSV'
});

// Gain / Loss statistics
Export.table.toDrive({

  collection: gainLossTable,

  description:
    'Gain_Loss_Statistics_2009_2022',

  fileFormat: 'CSV'

});

// Change summary
Export.table.toDrive({

  collection: changeSummary,

  description:
    'Change_Summary_2009_2022',

  fileFormat: 'CSV'

});
