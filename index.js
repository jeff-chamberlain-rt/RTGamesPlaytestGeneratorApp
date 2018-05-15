'use strict'

// Packages
const AWS = require("aws-sdk");

// Environment Variables
const kTableName = process.env.TABLE_NAME;

// Constant Objects
const DocClient = new AWS.DynamoDB.DocumentClient ();

exports.handler = function(event, context, callback) {
  var res ={
        "statusCode": 200,
        "headers": {
            "Content-Type": "*/*"
        }
    };

    console.log( event, context );
    callback( null, res );
};
