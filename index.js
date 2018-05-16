'use strict'

// Packages
const AWS = require("aws-sdk");
const querystring = require('querystring');

// Environment Variables
const kUserTableName = process.env.USER_TABLE_NAME;
const kPlaytestTableName = process.env.PLAYTEST_TABLE_NAME;
const kVerificationToken = process.env.VERIFICATION_TOKEN;
const kChannelId = process.env.CHANNEL_ID;
const kPlaytestExpirationWeeks = Number(process.env.PLAYTEST_EXPIRATION_WEEKS);
const kDefaultPlaytestCount = Number(process.env.DEFAULT_PLAYTEST_COUNT);

// Constant Objects
const DocClient = new AWS.DynamoDB.DocumentClient ();

exports.handler = function(event, context, callback) {
    var input = querystring.parse(event.body);
    if (!VerifyInput(input))
    {
      EphemeralResponse ( "Sorry! You can only create playtests in the #Ocelot channel!", callback );
      return;
    }

    var args = ParseArguments ( input.text );
    var caller = input.user_id;
    switch ( args[0] )
    {
      case 'add':
        ChangeUserState ( caller, args[1], 1, false, callback );
        break;
      case 'remove':
        ChangeUserState ( caller, args[1], 0, false, callback );
        break;
      case 'whitelist':
        ChangeUserState ( caller, args[1], 1, true, callback );
        break;
      case 'blacklist':
        ChangeUserState ( caller, args[1], 0, true, callback );
        break;
      case 'reset':
        ResetUser ( user, callback );
        break;
      case 'add-playtester':
        AddPlaytester( caller, args[1], callback );
        break;
      case 'remove-playtester':
        RemovePlaytester ( caller, args[1], callback );
        break;
      case 'give-privileges':
        GivePrivileges ( caller, args[1], callback );
        break;
      case 'remove-privileges':
        RemovePrivileges ( caller, args[1], callback );
        break;
      case 'preview':
        PreviewPlaytest( callback );
        break;
      case 'generate':
        GeneratePlaytest( args[1], callback );
        break;
      case 'undo':

        break;
      default:
        EphemeralResponse ( "Sorry! I couldn't understand your request", callback );
        break;
    }
};

function VerifyInput ( input ) {
  if ( !input
    || !input.token
    || input.token !== kVerificationToken
    || !input.channel_id
    || input.channel_id !== kChannelId )
  {
    return false;
  }

  return true;
}

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
  var reg = /@(\w+)\|(\w+)/
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

function ChangeUserState ( caller, argString, newState, isStatePermanent, callback )
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
        EphemeralResponse ( GenerateResponseText(), callback );
      }).catch(function(err) {
        console.log ( err );
        callback ( err )
      });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err )
    }
    else
    {
      EphemeralResponse( message, callback );
    }
  });
}

function ResetUser ( caller, argString, callback )
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
        callback ( err );
      }
      else
      {
        var prefix = caller === targetId ? 'Your' : targetUser.name + "'s";
        EphemeralResponse ( prefix + ' playtesting status has been reset', callback );
      }
    });

  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err )
    }
    else
    {
      EphemeralResponse( message, callback );
    }
  });
}

function AddPlaytester ( caller, userString, callback )
{
  var targetUser = GetTargetUser(userString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!", callback );
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
        callback ( err );
      }
      else
      {
        EphemeralResponse ( targetUser.name + ' has been added as a playtester!', callback );
      }
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err );
    }
    else
    {
      EphemeralResponse(message, callback);
    }
  });
}

function RemovePlaytester ( caller, argString, callback )
{
  var targetUser = GetTargetUser(userString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!", callback );
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
        callback ( err );
      }
      else
      {
        EphemeralResponse ( targetUser.name + ' is no longer a playtester.', callback );
      }
    });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err );
    }
    else
    {
      EphemeralResponse(message, callback);
    }
  });
}

function GivePrivileges ( caller, argString, callback )
{
  var targetUser = GetTargetUser(userString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!", callback );
    return;
  }

  VerifyAdminPrivileges( caller ).then( function() {
    UpdateUser ( targetUser.id, "Admin", true )
      .then (function() {
        EphemeralResponse ( targetUser.name + ' can now administer playtests!', callback );
      }).catch(function(err) {
        console.log ( err );
        callback ( err )
      });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err );
    }
    else
    {
      EphemeralResponse(message, callback);
    }
  });
}

function RemovePrivileges ( caller, argString, callback )
{
  var targetUser = GetTargetUser(userString);
  if ( !targetUser)
  {
    EphemeralResponse ( "User invalid!", callback );
    return;
  }

  VerifyAdminPrivileges( caller ).then( function() {
     UpdateUser ( targetUser.id, "Admin", false )
      .then (function() {
        EphemeralResponse ( targetUser.name + ' can no longer administer playtests.', callback );
      }).catch(function(err) {
        console.log ( err );
        callback ( err )
      });
  }).catch(function(err, message) {
    console.log ( err );
    if ( err )
    {
      callback ( err );
    }
    else
    {
      EphemeralResponse(message, callback);
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
              pool[userId].Count ++;
            }
          });

          if ( pool[userId].Count > maxCount )
          {
            maxCount = pool[userId].Count;
          }
        }

        for ( var userId in pool )
        {
          output.pool.push ( {
            id: pool[userId].User.id,
            name: pool[userId].User.name,
            entries: ( maxCount + 1 ) - pool[userId].Count
          })
        }

        resolve(output);
      });
    })
  });

  return oddsPromise;
}

function GeneratePlaytest ( _count, callback )
{
  var count = Number(_count);
  if ( isNaN(count))
  {
    count = kDefaultPlaytestCount;
  }


}

function PreviewPlaytest ( callback )
{
  GetPlaytestOdds().then(function(oddsOutput) {
    PlaytestPreviewReponse(oddsOutput, callback)
  }).catch(function(err) {
    callback(err);
  });
}

function PlaytestPreviewReponse( oddsOutput, callback )
{
  var attachment = {
    fallback: "Open slack on desktop to see full message",
    title: 'Playtest Preview',
    text: ''
  }

  oddsOutput.pool.forEach(function(poolUser) {
    attachment.text += poolUser.name + ' ' + poolUser.entries + ':' + kDefaultPlaytestCount + '\n';
  });

  attachment = AppendListsToAttachment( oddsOutput, attachment );
  var response = {
    response_type: 'in_channel',
    attachments: [ attachment ]
  };

  callback( null, response );
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

function EphemeralResponse ( text, callback )
{
  var response = {
    "response_type": "ephemeral",
    "text": text,
  };

  callback( null, response );
}