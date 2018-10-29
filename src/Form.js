// @flow strict

import * as React from "react";

import type {
  MetaField,
  OnBlur,
  OnValidation,
  Extras,
  FieldLink,
  ClientErrors,
  AdditionalRenderInfo,
} from "./types";
import {cleanMeta, cleanErrors} from "./types";
import {type FormState, isValid, getExtras, flatRootErrors} from "./formState";
import {
  type ShapedTree,
  type ShapedPath,
  treeFromValue,
  shapePath,
  updateAtPath,
  mapShapedTree,
} from "./shapedTree";
import {pathFromPathString} from "./tree";

export type FormContextPayload = {
  shouldShowError: (meta: MetaField) => boolean,
  // These values are taken into account in shouldShowError, but are also
  // available in their raw form, for convenience.
  pristine: boolean,
  submitted: boolean,
};
export const FormContext: React.Context<
  FormContextPayload
> = React.createContext({
  shouldShowError: () => true,
  pristine: false,
  submitted: true,
});

function applyServerErrorsToFormState<T>(
  serverErrors: null | {[path: string]: Array<string>},
  formState: FormState<T>
): FormState<T> {
  const [value, oldTree] = formState;

  let tree: ShapedTree<T, Extras>;
  if (serverErrors !== null) {
    // If keys do not appear, no errors
    tree = mapShapedTree(
      ({errors, meta}) => ({
        errors: {...errors, server: []},
        meta,
      }),
      oldTree
    );
    Object.keys(serverErrors).forEach(key => {
      const newErrors: Array<string> = serverErrors[key];
      const path = shapePath(value, pathFromPathString(key));

      if (path != null) {
        // TODO(zach): make some helper functions that do this
        tree = updateAtPath(
          path,
          ({errors, meta}) => ({
            errors: {...errors, server: newErrors},
            meta,
          }),
          tree
        );
      } else {
        console.error(
          `Warning: couldn't match error with path ${key} to value ${JSON.stringify(
            value
          )}`
        );
      }
    });
  } else {
    tree = mapShapedTree(
      ({errors, meta}) => ({
        errors: {...errors, server: []},
        meta,
      }),
      oldTree
    );
  }

  return [value, tree];
}

export type FeedbackStrategy =
  | "Always"
  | "OnFirstTouch"
  | "OnFirstChange"
  | "OnFirstSuccess"
  | "OnFirstSuccessOrFirstBlur"
  | "OnSubmit";

function getShouldShowError(strategy: FeedbackStrategy): MetaField => boolean {
  switch (strategy) {
    case "Always":
      return () => true;
    case "OnFirstTouch":
      return (meta: MetaField) => meta.touched;
    case "OnFirstChange":
      return (meta: MetaField) => meta.changed;
    default:
      throw new Error("Unimplemented feedback strategy: " + strategy);
  }
}

type Props<T, ExtraSubmitData> = {
  // This is *only* used to intialize the form. Further changes will be ignored
  +initialValue: T,
  +feedbackStrategy: FeedbackStrategy,
  +onSubmit: (T, ExtraSubmitData) => void,
  +onChange: T => void,
  +serverErrors: null | {[path: string]: Array<string>},
  +children: (
    link: FieldLink<T>,
    onSubmit: (ExtraSubmitData) => void,
    additionalInfo: AdditionalRenderInfo<T>
  ) => React.Node,
};
type State<T> = {
  formState: FormState<T>,
  pristine: boolean,
  submitted: boolean,
  oldServerErrors: null | {[path: string]: Array<string>},
};
export default class Form<T, ExtraSubmitData> extends React.Component<
  Props<T, ExtraSubmitData>,
  State<T>
> {
  static defaultProps = {
    onChange: () => {},
    onSubmit: () => {},
  };

  static getDerivedStateFromProps(
    props: Props<T, ExtraSubmitData>,
    state: State<T>
  ) {
    if (props.serverErrors !== state.oldServerErrors) {
      const newFormState = applyServerErrorsToFormState(
        props.serverErrors,
        state.formState
      );
      return {
        formState: newFormState,
        oldServerErrors: props.serverErrors,
      };
    }
    return null;
  }

  constructor(props: Props<T, ExtraSubmitData>) {
    super(props);

    const freshTree = treeFromValue(props.initialValue, {
      errors: cleanErrors,
      meta: cleanMeta,
    });
    const formState = applyServerErrorsToFormState(props.serverErrors, [
      props.initialValue,
      freshTree,
    ]);
    this.state = {
      formState,
      pristine: true,
      submitted: false,
      oldServerErrors: props.serverErrors,
    };
  }

  onSubmit: (extraData: ExtraSubmitData) => void = (
    extraData: ExtraSubmitData
  ) => {
    this.setState({submitted: true});
    this.props.onSubmit(this.state.formState[0], extraData);
  };

  updateFormState: (newValue: FormState<T>) => void = (
    newState: FormState<T>
  ) => {
    this.setState({formState: newState, pristine: false});
    this.props.onChange(newState[0]);
  };

  updateTree: OnBlur<T> = (newTree: ShapedTree<T, Extras>) => {
    this.setState({
      formState: [this.state.formState[0], newTree],
    });
  };

  updateTreeForValidation: OnValidation<T> = (
    path: ShapedPath<T>,
    errors: ClientErrors
  ) => {
    // TODO(zach): Move this into formState.js, it is gross
    const updater = newErrors => ({errors, meta}) => ({
      errors: {...errors, client: newErrors},
      meta: {
        ...meta,
        succeeded: newErrors.length === 0 ? true : meta.succeeded,
      },
    });
    this.setState(({formState: [value, tree]}) => ({
      formState: [value, updateAtPath(path, updater(errors), tree)],
    }));
  };

  render() {
    const {formState} = this.state;

    return (
      <FormContext.Provider
        value={{
          shouldShowError: getShouldShowError(this.props.feedbackStrategy),
          pristine: this.state.pristine,
          submitted: this.state.submitted,
        }}
      >
        {this.props.children(
          {
            formState,
            onChange: this.updateFormState,
            onBlur: this.updateTree,
            onValidation: this.updateTreeForValidation,
          },
          this.onSubmit,
          {
            touched: getExtras(formState).meta.touched,
            changed: getExtras(formState).meta.changed,
            shouldShowErrors: getShouldShowError(this.props.feedbackStrategy)(
              getExtras(formState).meta
            ),
            unfilteredErrors: flatRootErrors(formState),
            asyncValidationInFlight: false, // no validations on Form
            valid: isValid(formState),
            value: formState[0],
          }
        )}
      </FormContext.Provider>
    );
  }
}