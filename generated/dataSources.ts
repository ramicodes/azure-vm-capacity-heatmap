/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export default {
  "arm": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "Subscriptions_ListLocations": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/locations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Subscriptions_Get": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Subscriptions_List": {
        "path": "/{connectionId}/subscriptions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Deployments_Get": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "wait",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Deployments_CreateOrUpdate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "wait",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          }
        }
      },
      "Deployments_Delete": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "204": {
            "type": "void"
          }
        }
      },
      "Deployments_Cancel": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}/cancel",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          }
        }
      },
      "Deployments_Validate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}/validate",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "Deployments_ExportTemplate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}/exportTemplate",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Deployments_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DeploymentOperations_Get": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/deployments/{deploymentName}/operations/{operationId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DeploymentOperations_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/deployments/{deploymentName}/operations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "deploymentName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Providers_Unregister": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers/{resourceProviderNamespace}/unregister",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Providers_Register": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers/{resourceProviderNamespace}/register",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Providers_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Providers_Get": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers/{resourceProviderNamespace}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_ListResources": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/resources",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_Get": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_CreateOrUpdate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_Delete": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          }
        }
      },
      "ResourceGroups_Patch": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_ExportTemplate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/exportTemplate",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ResourceGroups_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Resources_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resources",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Resources_GetById": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{shortResourceId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Resources_CreateOrUpdateById": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{shortResourceId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "parameters",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          },
          "202": {
            "type": "void"
          }
        }
      },
      "Resources_DeleteById": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{shortResourceId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          },
          "204": {
            "type": "void"
          }
        }
      },
      "Resources_Invoke": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{shortResourceId}/{actionName}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceGroupName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "actionName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          }
        }
      },
      "Provider_Resources_GetById": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers/{resourceProviderNamespace}/{shortResourceId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Provider_Resources_Invoke": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/providers/{resourceProviderNamespace}/{shortResourceId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "resourceProviderNamespace",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "shortResourceId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          }
        }
      },
      "Tags_CreateOrUpdateValue": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/tagNames/{tagName}/tagValues/{tagValue}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagValue",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          }
        }
      },
      "Tags_DeleteValue": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/tagNames/{tagName}/tagValues/{tagValue}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagValue",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "204": {
            "type": "void"
          }
        }
      },
      "Tags_CreateOrUpdate": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/tagNames/{tagName}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          }
        }
      },
      "Tags_Delete": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/tagNames/{tagName}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "tagName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "204": {
            "type": "void"
          }
        }
      },
      "Tags_List": {
        "path": "/{connectionId}/subscriptions/{subscriptionId}/tagNames",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "subscriptionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  }
};
