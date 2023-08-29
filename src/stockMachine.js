import { createMachine, actions } from "xstate";
import { v4 as uuid } from "uuid";

const { sendTo, raise } = actions;

const updateContext = (
  context,
  { stakeholder_id, stock_class_id, security_id, quantity, share_price }
) => {
  // if active position is empty for this stakeholder, create it
  if (!context.activePositions[stakeholder_id]) {
    context.activePositions[stakeholder_id] = {};
  }
  context.activePositions[stakeholder_id][security_id] = {
    stock_class_id,
    quantity,
    share_price,
    timestamp: new Date().toISOString(),
    accepted: false,
  };

  if (!context.activeSecurityIdsByStockClass[stakeholder_id]) {
    context.activeSecurityIdsByStockClass[stakeholder_id] = {};
  }

  if (!context.activeSecurityIdsByStockClass[stakeholder_id][stock_class_id]) {
    context.activeSecurityIdsByStockClass[stakeholder_id][stock_class_id] = [];
  }

  context.activeSecurityIdsByStockClass[stakeholder_id][stock_class_id].push(
    security_id
  );
};

// TODO: what should the "resting state" be?
export const stockMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUAuB7AxgawAQFkBDTACwEsA7MAOgFUKzZYBXSAYjS2wEknnCKmMAG0ADAF1EoAA7pYZVGXQUpIAB6IAjABYArNQCcAJgAcmzQHYD2ixaMA2ewBoQAT0RHNB6ie2iTFgDMgSYGgUY2FgC+US6cOATE5FTUvCzs8dgAgphC0qgCQmKSSCCy8orKqhoI2iHUfia6IcFmuhEu7ghGptQWmvYmgboGBqL2uha6MXEYCUSklDRprBAcc9gAwoVgADa7hJUUxarlCkoqpTUhJtS65iN2muOB1p2I2qGGmsOmVj86TTTWIgTKJRYpHJ5VAZDYrHYnUpnI7VD5DBr2HpGKYGXSibQ2bTvBB2aiBCZ6US6XRDayvGagjbg5I0KFgfKwrgAFQATgJYAAzMA8xEyOTnKpXRAWezeUz3bRGcLUoluLT1US2AxmH6BfG6PQMsELFnUNkctaZbaCPYHI6isrilFSkmaIx9XQTCz+US-GXE4beQNhA20gk2I1Mk1LajWoT7dgAJTgYFQDuRF1RCAG2ga7WxRnxoXxBgsxM9twN3sCVlxdR6MRBFHQEDgqmNSSWpydmZdAFp7j5ZXYwsMfqI3mqEH2gdQfnpmr7NUZmqZI1xmTH6Ix0hBuxVe6Aan3AkPS0ZR-c9dZNMSlaI7lTjJ4DJZRCuTOv5p2UitIPuJUuI9EGCB97CBTFmjCAJAh+O9FTuewLDqGlQnCSIvzwaNIVydkYT3JEe0lYCSW0TRqBXHRtHsPRS2sXQ709ahxipIYVS8d97EwzcUjjW1-0Ig9iPURATFlPpRgBaiizMctPCHcDCVMbFtEbKIgA */
    id: "Stock Machine",
    initial: "Unissued",
    context: {
      activePositions: {},
      activeSecurityIdsByStockClass: {},
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
    states: {
      Unissued: {
        on: {
          StockIssuance: {
            target: "Issued",
            actions: ["issue"],
          },
        },
      },
      Issued: {
        on: {
          // not allowing more issuance until first position is accepted
          StockAcceptance: {
            target: "Accepted",
            actions: ["accept"],
          },
          StockCancellation: {
            target: "Cancelled",
            actions: ["cancel"],
          },
        },
      },
      Accepted: {
        on: {
          StockIssuance: {
            target: "Issued",
            actions: ["issue"],
          },
          StockTransfer: {
            target: "Issued",
            actions: ["transfer"],
          },
          StockCancellation: {
            target: "Cancelled",
            actions: ["cancel"],
          },
        },
      },
      Cancelled: {
        entry: raise({ type: "Reset" }), // hacky: since the cancel action is happening on a transition, it immediately resets when entering the cancel state.
        on: {
          Reset: {
            target: "Unissued",
          },
        },
      },
    },
  },
  {
    actions: {
      // not called anywhere yet
      transfer: (context, event) => {
        console.log("Transfer Action", event);
        const { quantity, stakeholder_id, stock_class_id } = event.value;

        const activeSecurityIds =
          context.activeSecurityIdsByStockClass[stakeholder_id][stock_class_id];
        if (!activeSecurityIds || !activeSecurityIds.length) {
          console.log("cannot find active position");
          throw new Error("cannot find active position");
        }

        let currentSum = 0;
        let securityIdsToDelete = [];
        for (let i = 0; i < activeSecurityIds.length; i++) {
          let security_id = activeSecurityIds[i];
          let activePosition =
            context.activePositions[stakeholder_id][security_id];

          currentSum += activePosition.quantity;
          securityIdsToDelete.push(security_id);

          if (quantity === currentSum) {
            console.log("complete transfer");
            delete context.activePositions[stakeholder_id][security_id];
            break;
          } else if (quantity < currentSum) {
            console.log("partial transfer");
            const remainingQuantity = currentSum - quantity;
            console.log("remainingQuantity", remainingQuantity);

            for (let j = 0; j < securityIdsToDelete.length; j++) {
              delete context.activePositions[stakeholder_id][
                securityIdsToDelete[j]
              ];
            }

            updateContext(context, {
              ...event.value,
              security_id: "UPDATED_SECURITY_ID",
              quantity: remainingQuantity,
            });
            break;
          }
        }
      },
      cancel: (context, event, meta) => {
        console.log("Cancel Action", event);

        const { quantity, stakeholder_id, security_id } = event.value;

        const activePosition =
          context.activePositions[stakeholder_id][security_id];

        if (!activePosition) {
          throw new Error("cannot find active position");
        }

        if (quantity === activePosition.quantity) {
          console.log("complete cancellation");
          delete context.activePositions[stakeholder_id][security_id];
        } else if (quantity < activePosition.quantity) {
          console.log("partial cancellation");
          const remainingQuantity = activePosition.quantity - quantity;
          console.log("remainingQuantity", remainingQuantity);

          delete context.activePositions[stakeholder_id][security_id];
          // now we move to the new issuance
          updateContext(context, {
            ...event.value,
            security_id: "UPDATED_SECURITY_ID",
            quantity: remainingQuantity,
            stock_class_id: activePosition.stock_class_id,
          });
        } else {
          throw new Error(
            "cannot cancel more than quantity of the active position"
          );
        }
      },
      issue: (context, event) => updateContext(context, event.value),
      accept: (context, event) => {
        console.log("Accept Action ", event);
        const { security_id, stakeholder_id } = event.value;
        const activePosition =
          context.activePositions[stakeholder_id][security_id];
        if (!activePosition) {
          console.log("cannot find active position");
          throw new Error("cannot find active position");
        } else {
          activePosition.accepted = true;
        }
      },
    },
    services: {},
    guards: {},
    delays: {},
  }
);
