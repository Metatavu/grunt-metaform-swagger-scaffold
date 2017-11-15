/* jshint esversion: 6 */
(function() {
  'use strict';
  
  const _ = require('lodash');
  const fs = require('fs');
  const YAML = require('yamljs');

  function resolveMetaformType(propertyAttributes) {
    const swaggerType = propertyAttributes.type;
    const swaggerFormat = propertyAttributes.format;

    if (propertyAttributes.enum) {
      return 'select';
    }

    if ((swaggerType === 'integer' || swaggerType === 'number') && (swaggerFormat === 'int32' || swaggerFormat === 'int64' || swaggerFormat === 'double')) {
      return 'number';
    }

    if (swaggerType === 'string' && swaggerFormat === undefined) {
      return 'text';
    }

    if (swaggerType === 'string' && swaggerFormat === 'date') {
      return 'date';
    }

    if (swaggerType === 'string' && swaggerFormat === 'date-time') {
      return 'date-time';
    }
    
    if (swaggerType === 'array' && propertyAttributes.items && propertyAttributes.items['$ref']) {
      return 'table';
    }
    
    return null;
  }
  
  function getReferencedProperties(swagger, ref) {
    const refType = ref.substring(ref.lastIndexOf('/') + 1);
    if (refType) {
      const referencedDefinition = swagger.definitions[refType];
      return referencedDefinition.properties;
    }
      
    return null;
  }

  function createForm(swagger, targetDirectory, definitionName, definition, definitionRules, operation) {
    const fileName = _.kebabCase(definitionName);
    const fileLocale = _.camelCase(definitionName);
    const operationCaptilized = _.capitalize(operation);
    const fields = [];
    const locales = {};
    const swaggerRequiredProperties = definition.required||[];
    const titleLocale = `forms.${fileLocale}${operationCaptilized}`;
    locales[titleLocale] = definitionName;
    let objectProperties = _.cloneDeep(definition.properties);
    
    _.forEach(definition.properties, (propertyAttributes, swaggerPropertyName) => {
      const fieldRule = (definitionRules.fields||{})[swaggerPropertyName];
      const flatten = fieldRule ? fieldRule.flatten : false;
      const prefixFlatProperties = fieldRule ? fieldRule.prefixFlatProperties : false;
      const ref = propertyAttributes['$ref'];
      if (ref && flatten) {
        const referencedProperties = getReferencedProperties(swagger, ref);
        if (prefixFlatProperties) {
          _.forEach(referencedProperties, (value, key) => {
            objectProperties[`${swaggerPropertyName}.${key}`] = value;
          });
        } else {
          _.merge(definition.properties, referencedProperties);
        }

        delete objectProperties[swaggerPropertyName];
      }
    });
    
    _.forEach(objectProperties, (propertyAttributes, swaggerPropertyName) => {

      const fieldRule = (definitionRules.fields||{})[swaggerPropertyName];

      const skip = fieldRule && fieldRule.skip;
      if (!skip) {
        const overriddenType = fieldRule ? fieldRule.type : null;
        const type = overriddenType || resolveMetaformType(propertyAttributes);
        const propertyName = _.camelCase(swaggerPropertyName);
        
        if (type) {
          const field = Object.assign({
            "name": propertyName,
            "type": type
          }, fieldRule ? fieldRule.extra || {} : {});

          if (type !== 'hidden') {
            const titleLocale = `forms.${fileLocale}${operationCaptilized}.${propertyName}`;
            locales[titleLocale] = propertyAttributes.description;
            field.title = `[[${titleLocale}]]`;
            field.required = swaggerRequiredProperties.indexOf(swaggerPropertyName) === -1 ? false : true;
          }

          if (type === 'select') {
            field.options = _.map(propertyAttributes.enum, (enumValue) => {
              const textLocale = `forms.${fileLocale}${operationCaptilized}.${propertyName}.${enumValue}`;
              locales[textLocale] = enumValue;
              return {
                text: `[[${textLocale}]]`,
                name: enumValue
              };
            });
          }
          
          if (type === "table") {
            const ref = propertyAttributes.items['$ref'];
            const referencedProperties = getReferencedProperties(swagger, ref);
            field.columns = [];
            field.addRows = true;
            
            _.forEach(referencedProperties, (referencedPropertyAttributes, referencedPropertyName) => {
              let type = resolveMetaformType(referencedPropertyAttributes);
              if (["text", "number", "select", "date", "time"].indexOf(type) !== -1) {
                if (type === 'select') {
                  type = 'enum';
                }
                
                const columnRule = fieldRule && fieldRule['columns'] ? fieldRule['columns'][referencedPropertyName] : null;
                const skipColumn = columnRule && columnRule.skip;
                if (!skipColumn) {
                  const column = Object.assign({
                    'title': `[[forms.${fileLocale}${operationCaptilized}.${propertyName}.${referencedPropertyName}]]`,
                    'name': referencedPropertyName,
                    'type': columnRule && columnRule['type'] ? columnRule['type'] : type,
                    'calculate-sum': columnRule && columnRule['calculate-sum'],
                    'order': columnRule && columnRule['order'] !== undefined ? columnRule['order'] : 100,
                    'min': columnRule ? columnRule['min'] : undefined,
                    'max': columnRule ? columnRule['max'] : undefined,
                    'step': columnRule ? columnRule['step'] : undefined
                  },  columnRule ? columnRule.extra || {} : {});

                  if (type === 'enum') {
                    column.values = _.map(referencedPropertyAttributes.enum || [], (enumValue) => {
                      return {
                        text: `[[forms.${fileLocale}${operationCaptilized}.${propertyName}.${referencedPropertyName}.${enumValue}]]`,
                        value: enumValue
                      };
                    });
                  }

                  field.columns.push(column);
                }
              }
            });
            
            if (fieldRule && fieldRule['extra-columns']) {
              _.forEach(fieldRule['extra-columns'], (extraColumn, extraColumnName) => {
                field.columns.push(Object.assign({
                  'title': `[[forms.${fileLocale}${operationCaptilized}.${propertyName}.${extraColumnName}]]`,
                  'name': extraColumnName
                }, extraColumn));
              });
            }
            
            if (field.columns) {
              field.columns.sort((c1, c2) => {
                return c1.order - c2.order;
              });
              
              _.forEach(field.columns, (column) => {
                delete column.order;
              });
            }
          }

          fields.push(field);
        }
      }
    });

    const saveLocale = `forms.${fileLocale}${operationCaptilized}.save`;
    locales[saveLocale] = 'Save';

    fields.push({
      "name": "submit",
      "type": "submit",
      "text": `[[${saveLocale}]]`
    });
    
    const form = {
      "title": `[[${titleLocale}]]`,
      "sections": [{
        "fields": fields
      }]
    };

    fs.writeFileSync(`${targetDirectory}/${fileName}-${operation}.json`, JSON.stringify(form, null, 2));
    fs.writeFileSync(`${targetDirectory}/${fileName}-${operation}-locales.json`, JSON.stringify(locales, null, 2));
  }
  
  module.exports = function(grunt) {

    grunt.registerMultiTask('metaform-scaffold', 'Generates metaforms from definitions', function () {
      const yamlFile = this.data.yamlFile;
      const swagger = YAML.load(yamlFile);
      const targetDirectory = this.data.targetDirectory;

      if (!fs.existsSync(targetDirectory)){
        fs.mkdirSync(targetDirectory);
      }

      const definitions = swagger.definitions;
      const definitionNames = Object.keys(definitions);
      const rules = this.data.rules;
      
      if (rules['prepare']) {
        _.forEach(rules['prepare'], (prepareRules, prepareDefinition) => {
          const definition = definitions[prepareDefinition];
          _.forEach(definition.properties, (propertyAttributes, propertyName) => {
            const fieldPrepareRules = prepareRules.fields[propertyName];
            if (fieldPrepareRules && fieldPrepareRules.flatten) {
              const ref = propertyAttributes['$ref'];
              if (ref) {
                const referencedProperties = getReferencedProperties(swagger, ref);
                _.merge(definition.properties, referencedProperties);
                delete definition.properties[propertyName];
              }
            }
          });
        });
      }

      definitionNames.forEach((definitionName) => {
        const definitionRules = _.merge({}, rules['*'] || {}, rules[definitionName] || {});
        if (!definitionRules.skip) { 
          const definition = definitions[definitionName];
          const updateRules = _.merge({}, definitionRules['*'] || {}, definitionRules['update'] || {});
          const createRules = _.merge({}, definitionRules['*'] || {}, definitionRules['create'] || {});

          createForm(swagger, targetDirectory, definitionName, definition, updateRules, 'update');
          createForm(swagger, targetDirectory, definitionName, definition, createRules, 'create');
        }
      });
    });
    
  };
  
}).call(this);