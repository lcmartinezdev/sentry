import React from 'react';
import omit from 'lodash/omit';

import SentryTypes from 'app/sentryTypes';
import {t, tct} from 'app/locale';
import {Panel, PanelAlert, PanelBody} from 'app/components/panels';
import {Client} from 'app/api';
import {addErrorMessage, addSuccessMessage} from 'app/actionCreators/indicator';
import ExternalLink from 'app/components/links/externalLink';

import {EventIdFieldStatus} from './dataPrivacyRulesEventIdField';
import DataPrivacyRulesPanelForm from './dataPrivacyRulesPanelForm';
import {Suggestion, defaultSuggestions} from './dataPrivacyRulesPanelSelectorFieldTypes';
import {RULE_TYPE, METHOD_TYPE} from './utils';
import DataprivacyRulesPanelHeader from './dataprivacyRulesPanelHeader';
import DataPrivacyRulesPanelFooter from './dataPrivacyRulesPanelFooter';

const DEFAULT_RULE_FROM_VALUE = '';

type Rule = React.ComponentProps<typeof DataPrivacyRulesPanelForm>['rule'];

type PiiConfig = {
  type: RULE_TYPE;
  pattern: string;
  redaction?: {
    method?: METHOD_TYPE;
  };
};

type PiiConfigRule = {
  [key: string]: PiiConfig;
};

type Applications = {[key: string]: Array<string>};

type Props = {
  disabled?: boolean;
  endpoint: string;
  relayPiiConfig?: string;
  additionalContext?: React.ReactNode;
};

type State = {
  rules: Array<Rule>;
  savedRules: Array<Rule>;
  relayPiiConfig?: string;
  selectorSuggestions: Array<Suggestion>;
  eventIdInputValue: string;
  eventIdStatus: EventIdFieldStatus;
};

class DataPrivacyRulesPanel extends React.Component<Props, State> {
  static contextTypes = {
    organization: SentryTypes.Organization,
    project: SentryTypes.Project,
  };

  state: State = {
    rules: [],
    savedRules: [],
    relayPiiConfig: this.props.relayPiiConfig,
    selectorSuggestions: [],
    eventIdStatus: EventIdFieldStatus.NONE,
    eventIdInputValue: '',
  };

  componentDidMount() {
    this.loadRules();
    this.loadSelectorSuggestions();
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (prevState.relayPiiConfig !== this.state.relayPiiConfig) {
      this.loadRules();
    }
  }

  componentWillUnmount() {
    this.api.clear();
  }

  api = new Client();

  loadRules() {
    try {
      const relayPiiConfig = this.state.relayPiiConfig;
      const piiConfig = relayPiiConfig ? JSON.parse(relayPiiConfig) : {};
      const rules: PiiConfigRule = piiConfig.rules || {};
      const applications: Applications = piiConfig.applications || {};
      const convertedRules: Array<Rule> = [];

      for (const application in applications) {
        for (const rule of applications[application]) {
          if (!rules[rule]) {
            if (rule[0] === '@') {
              const [type, method] = rule.slice(1).split(':');
              convertedRules.push({
                id: convertedRules.length,
                type: type as RULE_TYPE,
                method: method as METHOD_TYPE,
                from: application,
              });
            }
            continue;
          }

          const resolvedRule = rules[rule];
          if (resolvedRule.type === RULE_TYPE.PATTERN && resolvedRule.pattern) {
            const method = resolvedRule?.redaction?.method;

            convertedRules.push({
              id: convertedRules.length,
              type: RULE_TYPE.PATTERN,
              method: method as METHOD_TYPE,
              from: application,
              customRegularExpression: resolvedRule.pattern,
            });
          }
        }
      }

      this.setState({
        rules: convertedRules,
        savedRules: convertedRules,
      });
    } catch {
      addErrorMessage(t('Unable to load the rules'));
    }
  }

  loadSelectorSuggestions = async () => {
    const {organization, project} = this.context;
    const {eventIdInputValue} = this.state;

    if (!eventIdInputValue) {
      this.setState({
        selectorSuggestions: defaultSuggestions,
        eventIdStatus: EventIdFieldStatus.NONE,
      });
      return;
    }

    this.setState({eventIdStatus: EventIdFieldStatus.LOADING});

    const rawSuggestions = await this.api.requestPromise(
      `/organizations/${organization.slug}/data-scrubbing-selector-suggestions/`,
      {method: 'GET', query: {project: project?.id, eventId: eventIdInputValue}}
    );

    const selectorSuggestions: Array<Suggestion> = rawSuggestions.suggestions;

    if (selectorSuggestions && selectorSuggestions.length > 0) {
      this.setState({
        selectorSuggestions,
        eventIdStatus: EventIdFieldStatus.LOADED,
      });
    } else {
      this.setState({
        selectorSuggestions: defaultSuggestions,
        eventIdStatus: EventIdFieldStatus.NOT_FOUND,
      });
    }
  };

  handleEventIdChange = (value: string) => {
    const eventId = value.replace(/-/g, '').trim();
    this.setState({
      eventIdStatus: EventIdFieldStatus.NONE,
      selectorSuggestions: defaultSuggestions,
      eventIdInputValue: eventId,
    });
  };

  handleEventIdBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    event.preventDefault();

    const {eventIdInputValue} = this.state;
    if (eventIdInputValue && eventIdInputValue.length !== 32) {
      this.setState({eventIdStatus: EventIdFieldStatus.INVALID});
    } else {
      this.loadSelectorSuggestions();
    }
  };

  handleAddRule = () => {
    this.setState(prevState => ({
      rules: [
        ...prevState.rules,
        {
          id: prevState.rules.length + 1,
          type: RULE_TYPE.CREDITCARD,
          method: METHOD_TYPE.MASK,
          from: DEFAULT_RULE_FROM_VALUE,
        },
      ],
    }));
  };

  handleDeleteRule = (ruleId: number) => {
    this.setState(prevState => ({
      rules: prevState.rules.filter(rule => rule.id !== ruleId),
    }));
  };

  handleChange = (updatedRule: Rule) => {
    this.setState(prevState => ({
      rules: prevState.rules.map(rule => {
        if (rule.id === updatedRule.id) {
          return updatedRule;
        }
        return rule;
      }),
    }));
  };

  handleSubmit = async () => {
    const {endpoint} = this.props;
    const {rules} = this.state;
    let customRulesCounter = 0;
    const applications: Applications = {};
    const customRules: PiiConfigRule = {};

    for (const rule of rules) {
      let ruleName = `@${rule.type}:${rule.method}`;
      if (rule.type === RULE_TYPE.PATTERN && rule.customRegularExpression) {
        ruleName = `customRule${customRulesCounter}`;

        customRulesCounter += 1;

        customRules[ruleName] = {
          type: RULE_TYPE.PATTERN,
          pattern: rule.customRegularExpression,
          redaction: {
            method: rule.method,
          },
        };
      }

      if (!applications[rule.from]) {
        applications[rule.from] = [];
      }

      if (!applications[rule.from].includes(ruleName)) {
        applications[rule.from].push(ruleName);
      }
    }

    const piiConfig = {
      rules: customRules,
      applications,
    };

    const relayPiiConfig = JSON.stringify(piiConfig);

    await this.api
      .requestPromise(endpoint, {
        method: 'PUT',
        data: {relayPiiConfig},
      })
      .then(() => {
        this.setState({
          relayPiiConfig,
        });
      })
      .then(() => {
        addSuccessMessage(t('Successfully saved data scrubbing rules'));
      })
      .catch(() => {
        addErrorMessage(t('An error occurred while saving data scrubbing rules'));
      });
  };

  handleValidation = () => {
    const {rules} = this.state;
    const isAnyRuleFieldEmpty = rules.find(rule => {
      const ruleKeys = Object.keys(omit(rule, 'id'));
      const anyEmptyField = ruleKeys.find(ruleKey => !rule[ruleKey]);
      return !!anyEmptyField;
    });

    const isFormValid = !isAnyRuleFieldEmpty;

    if (isFormValid) {
      this.handleSubmit();
    } else {
      addErrorMessage(t('Invalid rules form'));
    }
  };

  handleSaveForm = () => {
    this.handleValidation();
  };

  handleCancelForm = () => {
    this.setState(prevState => ({
      rules: prevState.savedRules,
    }));
  };

  render() {
    const {additionalContext, disabled} = this.props;
    const {
      rules,
      savedRules,
      eventIdInputValue,
      selectorSuggestions,
      eventIdStatus,
    } = this.state;
    return (
      <React.Fragment>
        <Panel>
          <DataprivacyRulesPanelHeader
            onChange={this.handleEventIdChange}
            onBlur={this.handleEventIdBlur}
            value={eventIdInputValue}
            status={eventIdStatus}
            disabled={disabled}
          />
          <PanelAlert type="info">
            {additionalContext}{' '}
            {tct('For more details, see [linkToDocs].', {
              linkToDocs: (
                <ExternalLink href="https://docs.sentry.io/data-management/advanced-datascrubbing/">
                  {t('full documentation on data scrubbing')}
                </ExternalLink>
              ),
            })}
          </PanelAlert>
          <PanelBody>
            {rules.map(rule => (
              <DataPrivacyRulesPanelForm
                key={rule.id}
                onDelete={this.handleDeleteRule}
                onChange={this.handleChange}
                selectorSuggestions={selectorSuggestions}
                rule={rule}
                disabled={disabled}
              />
            ))}
          </PanelBody>
          <DataPrivacyRulesPanelFooter
            hideButtonBar={savedRules.length === 0 && rules.length === 0}
            onAddRule={this.handleAddRule}
            onCancel={this.handleCancelForm}
            onSave={this.handleSaveForm}
            disabled={disabled}
          />
        </Panel>
      </React.Fragment>
    );
  }
}

export default DataPrivacyRulesPanel;
