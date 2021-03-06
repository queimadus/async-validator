import {format, complementError, asyncMap} from './util';
import validators from './validator/';
import {messages as defaultMessages, newMessages} from './messages';
import {error} from './rule/';
import mergeWith from 'lodash.mergewith';

function mergeCustomizer(objValue, srcValue) {
  if (typeof objValue !== 'object') {
    return srcValue;
  }
}

/**
 *  Encapsulates a validation schema.
 *
 *  @param descriptor An object declaring validation rules
 *  for this schema.
 */
function Schema(descriptor) {
  this.rules = null;
  this._messages = defaultMessages;
  this.define(descriptor);
}

Schema.prototype = {
  messages(messages) {
    if (messages) {
      this._messages = mergeWith(newMessages(), messages, mergeCustomizer);
    }
    return this._messages;
  },
  define(rules) {
    if (!rules) {
      throw new Error(
        'Cannot configure a schema with no rules');
    }
    if (typeof rules !== 'object' || Array.isArray(rules)) {
      throw new Error('Rules must be an object');
    }
    this.rules = {};
    let z;
    let item;
    for (z in rules) {
      if (rules.hasOwnProperty(z)) {
        item = rules[z];
        this.rules[z] = Array.isArray(item) ? item : [item];
      }
    }
  },
  validate(source_, o = {}, oc) {
    let source = source_;
    let options = o;
    if (!this.rules) {
      throw new Error('Cannot validate with no rules.');
    }
    let callback = oc;
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    function complete(results) {
      let i;
      let field;
      let errors = [];
      let fields = {};

      function add(e) {
        if (Array.isArray(e)) {
          errors = errors.concat.apply(errors, e);
        } else {
          errors.push(e);
        }
      }

      for (i = 0; i < results.length; i++) {
        add(results[i]);
      }
      if (!errors.length) {
        errors = null;
        fields = null;
      } else {
        for (i = 0; i < errors.length; i++) {
          field = errors[i].field;
          fields[field] = fields[field] || [];
          fields[field].push(errors[i]);
        }
      }
      callback(errors, fields);
    }

    if (options.messages) {
      let messages = this.messages();
      if (messages === defaultMessages) {
        messages = newMessages();
      }
      mergeWith(messages, options.messages, mergeCustomizer);
      options.messages = messages;
    } else {
      options.messages = this.messages();
    }

    options.error = error;
    let arr;
    let value;
    const series = {};
    const keys = options.keys || Object.keys(this.rules);
    keys.forEach((z) => {
      arr = this.rules[z];
      value = source[z];
      arr.forEach((r) => {
        let rule = r;
        if (typeof (rule.transform) === 'function') {
          if (source === source_) {
            source = {...source};
          }
          value = source[z] = rule.transform(value);
        }
        if (typeof (rule) === 'function') {
          rule = {
            validator: rule,
          };
        } else {
          rule = {...rule};
        }
        rule.field = z;
        rule.fullField = rule.fullField || z;
        rule.type = this.getType(rule);
        rule.validator = this.getValidationMethod(rule);
        if (!rule.validator) {
          return;
        }
        series[z] = series[z] || [];
        series[z].push({
          rule: rule,
          value: value,
          source: source,
          field: z,
        });
      });
    });
    const errorFields = {};
    asyncMap(series, options, (data, doIt) => {
      const rule = data.rule;
      let deep = (rule.type === 'object' || rule.type === 'array') && typeof (rule.fields) === 'object';
      deep = deep && (rule.required || (!rule.required && data.value));
      rule.field = data.field;
      function cb(e = []) {
        let errors = e;
        if (!Array.isArray(errors)) {
          errors = [errors];
        }
        if (errors.length && rule.message) {
          errors = [].concat(rule.message);
        }

        errors = errors.map(complementError(rule));

        if ((options.first || options.fieldFirst) && errors.length) {
          errorFields[rule.field] = 1;
          return doIt(errors);
        }
        if (!deep) {
          doIt(errors);
        } else {
          // if rule is required but the target object
          // does not exist fail at the rule level and don't
          // go deeper
          if (rule.required && !data.value) {
            if (rule.message) {
              errors = [].concat(rule.message).map(complementError(rule));
            } else {
              errors = [options.error(rule, format(options.messages.required, rule.field))];
            }
            return doIt(errors);
          }
          const fieldsSchema = data.rule.fields;
          for (const f in fieldsSchema) {
            if (fieldsSchema.hasOwnProperty(f)) {
              const fieldSchema = fieldsSchema[f];
              fieldSchema.fullField = rule.fullField + '.' + f;
            }
          }
          const schema = new Schema(fieldsSchema);
          schema.messages(options.messages);
          if (data.rule.options) {
            data.rule.options.messages = options.messages;
            data.rule.options.error = options.error;
          }
          schema.validate(data.value, data.rule.options || options, (errs) => {
            doIt(errs && errs.length ? errors.concat(errs) : errs);
          });
        }
      }

      rule.validator(
        rule, data.value, cb, data.source, options);
    }, (results) => {
      complete(results);
    });
  },
  getType(rule) {
    if (rule.type === undefined && (rule.pattern instanceof RegExp)) {
      rule.type = 'pattern';
    }
    if (typeof (rule.validator) !== 'function' && (rule.type && !validators.hasOwnProperty(rule.type))) {
      throw new Error(format('Unknown rule type %s', rule.type));
    }
    return rule.type || 'string';
  },
  getValidationMethod(rule) {
    if (typeof rule.validator === 'function') {
      return rule.validator;
    }
    return validators[rule.type] || false;
  },
};

Schema.register = function register(type, validator) {
  if (typeof validator !== 'function') {
    throw new Error('Cannot register a validator by type, validator is not a function');
  }
  validators[type] = validator;
};

Schema.messages = defaultMessages;

export default Schema;
