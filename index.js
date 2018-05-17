'use strict'

// Packages
const AWS = require("aws-sdk");
const https = require('https');
const url = require('url');

// Environment Variables
const kUserTableName = process.env.USER_TABLE_NAME;
const kPlaytestTableName = process.env.PLAYTEST_TABLE_NAME;
const kVerificationToken = process.env.VERIFICATION_TOKEN;
const kChannelId = process.env.CHANNEL_ID;
const kPlaytestExpirationWeeks = Number(process.env.PLAYTEST_EXPIRATION_WEEKS);
const kDefaultPlaytestCount = Number(process.env.DEFAULT_PLAYTEST_COUNT);

// Constant Objects
const DocClient = new AWS.DynamoDB.DocumentClient ();

var responseURL = {};

exports.handler = function(event, context ) {
  const.log(context);
  var input = context.Records[0].Sns.Message;

  responseURL = url.parse( input.response_url );

  var args = ParseArguments ( input.text );
  var caller = input.user_id;
  switch ( args[0] )
  {
    case 'add':
    ChangeUserState ( caller, args[1], 1, false );
    break;
    case 'remove':
    ChangeUserState ( caller, args[1], 0, false );
    break;
    case 'whitelist':
    ChangeUserState ( caller, args[1], 1, true );
    break;
    case 'blacklist':
    ChangeUserState ( caller, args[1], 0, true );
    break;
    case 'reset':
    ResetUser ( caller, args[1] );
    break;
    case 'add-playtester':
    AddPlaytester( caller, args[1] );
    break;
    case 'remove-playtester':
    RemovePlaytester ( caller, args[1] );
    break;
    case 'give-privileges':
    GivePrivileges ( caller, args[1] );
    break;
    case 'remove-privileges':
    RemovePrivileges ( caller, args[1] );
    break;
    case 'preview':
    PreviewPlaytest();
    break;
    case 'generate':
    GeneratePlaytest( args[1] );
    break;
    case 'undo':

    break;
    default:
    EphemeralResponse ( "Sorry! I couldn't understand your request" );
    break;
  }
};

function ParseArguments ( argString )
{
  if ( !argString )
  {
    return [];
  }

  var reg = /(\s+)/;
  return argString.split(reg).filter(function(item){ return item.trim().length > 0; });
}

function GetTargetUser ( argString )
{
  var reg = /@(\w+)\|(\w+)/;
  var match = reg.exec(argString);
  if ( !match )
  {
    return undefined;
  }

  return {
    id: match[1],
    name: match[2]
  };
}

function ChangeUserState ( caller, argString, newState, isStatePermanent )
{
  var targetUser = GetTargetUser ( argString );
  var targetId = undefined;
  if ( !targetUser )
  {
    targetId = caller;
  }
  else
  {
    targetId = targetUser.id;
  }

  function GenerateResponseText () {
    var prefix = targetId === caller ? 'You have' : targetUser.name + ' has';
    var action = isStatePermanent || newState > 0 ? 'been added to' : 'been removed from';
    var suffix = isStatePermanent ? ( newState > 0 ? 'the whitelist' : 'the blacklist' ) : "today's playtest";
    return prefix + ' ' + action + ' ' + suffix;
  }
  // First verify the user can actually change the state of the target user
  new Promise ( function ( resolve, reject ) {
    // users can always change their own state, only admins can change others'
    if ( targetId === caller )
    {
      resolve ();
    }
    else
    {
      VerifyAdminPrivileges( caller ).then( resolve ).catch ( reject );
    }
  }).then(function() {
    UpdateUser( targetId, isStatePermanent ? 'PermState' : 'TempState', newState )
    .then (function() {
      EphemeralResponse ( GenerateResponseText() );
    }).catch(function(err) {
      console.log ( err );
      EphemeralResponse ( err );
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      EphemeralResponse ( err );
    }
    else
    {
      EphemeralResponse( message );
    }
  });
}

function ResetUser ( caller, argString )
{
  var targetUser = GetTargetUser ( argString );
  var targetId = undefined;
  if ( !targetUser )
  {
    targetId = caller;
  }
  else
  {
    targetId = targetUser.id;
  }

  // First verify the user can actually change the state of the target user
  new Promise ( function ( resolve, reject ) {
    // users can always change their own state, only admins can change others'
    if ( targetId === caller )
    {
      resolve ();
    }
    else
    {
      VerifyAdminPrivileges( caller ).then( resolve ).catch ( reject );
    }
  }).then(function() {
    var params = {
      TableName: kUserTableName,
      Key : {
        UserId: targetId,
      },
      UpdateExpression: 'SET PermState = :perm_value, TempState = :temp_value, LastRequestTimestamp = :timestamp',
      ExpressionAttributeValues: {
        ':temp_value': 2,
        ':perm_value': 2,
        ':timestamp': Date.now()
      }
    };

    DocClient.put(params, function(err, data) {
      if ( err )
      {
        console.log ( err );
        EphemeralResponse ( err );
      }
      else
      {
        var prefix = caller === targetId ? 'Your' : targetUser.name + "'s";
        EphemeralResponse ( prefix + ' playtesting status has been reset' );
      }
    });

  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      EphemeralResponse ( err );
    }
    else
    {
      EphemeralResponse( message );
    }
  });
}

function AddPlaytester ( caller, userString )
{
  var targetUser = GetTargetUser(userString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!" );
    return;
  }

  VerifyAdminPrivileges( caller ).then (function() {
    var params = {
      "TableName": kUserTableName,
      "Item": {
        "UserId": targetUser.id,
        "UserName": targetUser.name,
        "PermState": 2,
        "TempState": 2,
        "LastRequestTimestamp": 0,
        "Admin": false
      }
    };

    DocClient.put(params, function(err, data) {
      if ( err )
      {
        console.log ( err );
        EphemeralResponse ( err );
      }
      else
      {
        EphemeralResponse ( targetUser.name + ' has been added as a playtester!' );
      }
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      EphemeralResponse ( err );
    }
    else
    {
      EphemeralResponse( message );
    }
  });
}

function RemovePlaytester ( caller, argString )
{
  var targetUser = GetTargetUser(argString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!" );
    return;
  }

  VerifyAdminPrivileges( caller ).then( function() {
    var params = {
      "TableName": kUserTableName,
      "Key": {
        "UserId": targetUser.id,
      }
    };

    DocClient.delete(params, function(err, data) {
      if ( err )
      {
        console.log ( err );
        EphemeralResponse ( err );
      }
      else
      {
        EphemeralResponse ( targetUser.name + ' is no longer a playtester.' );
      }
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      EphemeralResponse ( err );
    }
    else
    {
      EphemeralResponse( message );
    }
  });
}

function GivePrivileges ( caller, argString )
{
  var targetUser = GetTargetUser(argString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!" );
    return;
  }

  VerifyAdminPrivileges( caller ).then( function() {
    UpdateUser ( targetUser.id, "Admin", true )
    .then (function() {
      EphemeralResponse ( targetUser.name + ' can now administer playtests!' );
    }).catch(function(err) {
      console.log ( err );
      EphemeralResponse ( err );
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      EphemeralResponse ( err );
    }
    else
    {
      EphemeralResponse( message );
    }
  });
}

function RemovePrivileges ( caller, argString )
{
  var targetUser = GetTargetUser(argString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!" );
    return;
  }

  VerifyAdminPrivileges( caller ).then( function() {
   UpdateUser ( targetUser.id, "Admin", false )
   .then (function() {
    EphemeralResponse ( targetUser.name + ' can no longer administer playtests.' );
  }).catch(function(err) {
    console.log ( err );
    EphemeralResponse ( err );
  });
}).catch(function(err, message) {
  console.log ( err );
  if ( err )
  {
    EphemeralResponse ( err );
  }
  else
  {
    EphemeralResponse( message );
  }
});
}

function UpdateUser ( userId, attributeToUpdate, newAttributeValue )
{
  var params = {
    TableName: kUserTableName,
    Key : {
      UserId: userId,
    },
    UpdateExpression: 'SET #attribute_name = :attribute_value, LastRequestTimestamp = :timestamp',
    ExpressionAttributeNames: {
      '#attribute_name': attributeToUpdate
    },
    ExpressionAttributeValues: {
      ':attribute_value': newAttributeValue,
      ':timestamp': Date.now()
    }
  };

  var updatePromise = new Promise ( function ( resolve, reject ) {
    DocClient.update ( params, function( err, data ) {
      if ( err )
      {
        console.log ( err );
        reject ( err );
      }
      else
      {
        resolve ();
      }
    });
  });

  return updatePromise;
}

function GetPlaytestOdds ()
{
  var output = {
    pool: [],
    whitelist: [],
    added: [],
    blacklist: [],
    removed: []
  };

  // get last midnight in Austin
  var tempExpiration = new Date ().setUTCHours(5, 0, 0, 0);

  var oddsPromise = new Promise( function ( resolve, reject ) {
    var params = {
      TableName: kUserTableName
    };

    DocClient.scan(params, function(err, data) {
      if ( err || !data || !data.Items )
      {
        reject ( err );
        return;
      }

      var pool = {};
      data.Items.forEach(function(item) {
        var user = {
          id: item.UserId,
          name: item.UserName
        };

        // only accept temp states set in the last day
        var tempState = 2;
        if ( item.LastRequestTimestamp > tempExpiration )
        {
          tempState = item.TempState;
        }

        if ( tempState === 1 )
        {
          output.added.push(user);
          return;
        }

        if ( tempState === 0 )
        {
          output.removed.push(user);
          return;
        }

        if ( item.PermState === 1 )
        {
          output.whitelist.push(user);
          return;
        }

        if ( item.PermState === 0 )
        {
          output.blacklist.push(user);
          return;
        }

        pool[user.id] = {
          User: user,
          PlaytestCount: 0
        };
      });

      // get epoch timestamp from 3 weeks ago
      var playtestExpiration = Math.floor(Date.now()/1000) - ( kPlaytestExpirationWeeks*7*24*60*60 );
      var playtestParams = {
        TableName: kPlaytestTableName,
        FilterExpression: 'PlaytestGenerationTimestamp > :expiration',
        ExpressionAttributeValues: {
          ':expiration': playtestExpiration
        },
        Select: 'SPECIFIC_ATTRIBUTES',
        ProjectionExpression: "Playtesters",
      };

      DocClient.scan( playtestParams, function(err, data) {
        if ( err )
        {
          reject ( err );
          return;
        }

        var playtests = data.Items || [];
        var maxCount = 0;
        for ( var userId in pool )
        {
          playtests.forEach(function(playtest) {
            if ( playtest.Playtesters.includes(userId) )
            {
              pool[userId].PlaytestCount ++;
            }
          });

          if ( pool[userId].PlaytestCount > maxCount )
          {
            maxCount = pool[userId].PlaytestCount;
          }
        }

        for ( var id in pool )
        {
          output.pool.push ( {
            id: pool[id].User.id,
            name: pool[id].User.name,
            entries: ( maxCount + 1 ) - pool[id].PlaytestCount
          });
        }

        resolve(output);
      });
    });
  });

  return oddsPromise;
}

function GeneratePlaytest ( _count )
{
  var count = Number(_count);
  if ( isNaN(count))
  {
    count = kDefaultPlaytestCount;
  }


}

function PreviewPlaytest ()
{
  GetPlaytestOdds().then(function(oddsOutput) {
    PlaytestPreviewReponse(oddsOutput);
  }).catch(function(err) {
    console.log(err);
    EphemeralResponse(err);
  });
}

function PlaytestPreviewReponse( oddsOutput )
{
  var attachment = {
    fallback: "Open slack on desktop to see full message",
    title: 'Playtest Preview',
    text: ''
  };

  oddsOutput.pool.forEach(function(poolUser) {
    attachment.text += poolUser.name + ' ' + poolUser.entries + ':' + kDefaultPlaytestCount + '\n';
  });

  attachment = AppendListsToAttachment( oddsOutput, attachment );
  var response = {
    response_type: 'in_channel',
    attachments: [ attachment ]
  };

  PostResponse ( response );
}

function AppendListsToAttachment ( oddsOutput, attachment )
{
  attachment.fields = [];

  function addField ( title )
  {
    var field = {
      title: title,
      short: true,
      value: ''
    };

    oddsOutput[title].forEach(function(user) {
      if ( field.value === '' )
      {
        field.value += user.name;
      }
      else
      {
        field.value += ', ' + user.name;
      }
    });

    attachment.fields.push(field);
  }

  addField('added');
  addField('whitelist');
  addField('removed');
  addField('blacklist');
  return attachment;
}

function VerifyAdminPrivileges ( userId ) {
  var params = {
    TableName: kUserTableName,
    KeyConditionExpression: 'UserId = :user_id',
    FilterExpression: 'Admin = :admin_value',
    ExpressionAttributeValues: {
      ':user_id': userId,
      ':admin_value': true
    },
    Select: 'COUNT'
  };

  var verifyPromise = new Promise ( function ( resolve, reject ) {
    DocClient.query( params, function( err, data ) {
      if ( err )
      {
        reject ( err );
        return;
      }

      if ( data.Count <= 0 )
      {
        reject ( null, "You do not have permission to do that!");
      }
      else
      {
        resolve ();
      }
    });
  });

  return verifyPromise;
}

function EphemeralResponse ( text )
{
  var response = {
    "response_type": "ephemeral",
    "text": text,
  };

  PostResponse ( response );
}

function PostResponse ( data )
{
  var options = {
    hostname: responseURL.hostname,
    path: responseURL.path,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    }
  };

  var req = https.request (options);
  req.write(JSON.stringify(data));
  req.end();
}