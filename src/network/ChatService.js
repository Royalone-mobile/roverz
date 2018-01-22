// import moment from 'moment';
import Meteor from 'react-native-meteor';
import { Actions } from 'react-native-router-flux';
import md5 from 'react-native-md5';
import moment from 'moment';
import AppUtil from '../lib/util';

import Application from '../constants/config';
// import { showCallScreen } from '@webrtc/ui';


class ChatService {

  init(meteor, db) {
    this.meteor = meteor;
    this.db = db;
    this._groupSubsriptionMap = {};
    this._monStreamNotifyUser = null;
    this._monUsers = null;
    this._monStreamRoomMessages = null;
    this._monStreamNotifyRoom = null;
    this._cache = db.remotefiles ? db.remotefiles.cacheList : {};
    this._loginSettings = [];
    this.deleteAllowed = false;
    this.blockDeleteInMinutes = 0;
    Application.setUserId(db.userId);
  }

  resetDbHandle(newDb) {
    this.db = newDb;
    this._cache = newDb.remotefiles.cacheList;
  }

  // getUsersOfRoom, groupId, true (show all)
  // getUsersOfRoom, groupId, false (show online)
  // profile view: fullUserData
  // https://instance/avatar/kumar

  // break subscriptions to user
  initSubscriptions() {
    var _super = this;
    const uid = Meteor.userId();
    // console.log(`[Meteor] UserId is : ${uid}`);

    // save the user to db
    this.db.setUserId(uid);
    Application.setUserId(uid);

    // Need to vet all these and see what all we actually use in client
    // this._subscribe('stream-notify-all', "public-settings-changed", false);
    this.meteor.subscribe('stream-notify-user', `${uid}/subscriptions-changed`, false);
    this.meteor.subscribe('stream-notify-user', `${uid}/notification`, false);
    this.meteor.subscribe('stream-notify-user', `${uid}/rooms-changed`, false);
    this.meteor.subscribe('stream-notify-user', `${uid}/message`, false);
    this.meteor.subscribe('stream-notify-user', `${uid}/webrtc`, false);
//    this.meteor.subscribe('stream-notify-user', `${Meteor.userId()}/rooms-changed`, false);

    // this._subscribe('stream-notify-user', Meteor.userId()+"/otr", false);
    // this._subscribe('stream-notify-logged', "permissions-changed", false);
    // this._subscribe('meteor.loginServiceConfiguration');
    // this._subscribe('stream-notify-logged', 'roles-change', false);
    // this._subscribe('stream-notify-logged', 'updateEmojiCustom', false); // no
    // this._subscribe('stream-notify-logged', 'deleteEmojiCustom', false); // no
    // this._subscribe('stream-notify-logged', 'Users:NameChanged', false);
    // this._subscribe('stream-notify-logged', 'updateAvatar', false);
    // this._subscribe('stream-notify-logged', 'permissions-changed', false);
    // this._subscribe('stream-notify-all', 'updateCustomSound', false); // no
    // this._subscribe('stream-notify-all', 'deleteCustomSound', false); // no
    this.meteor.subscribe('roles');
    this.meteor.subscribe('userData');
    this.meteor.subscribe('activeUsers');
    // this._subscribe('users', cb);

    // @todo: The return value to be used for unsubscribe
    this._monStreamNotifyUser = this.meteor.monitorChanges('stream-notify-user', (results) => {
      if (results && results.length > 0) {
        // // console.log('User changes:', results);
        // take some action here
        // update subscriptions-changed
        if (results[0].eventName.endsWith('subscriptions-changed') || results[0].eventName.endsWith('rooms-changed')) {
          // console.log('User Subscription updated:', results[0].args[0], results[0].args[1]);
          const msgs = [];
          msgs.push(results[0].args[1]);
          const subscriptions = _super._subscription2group(msgs);
          if (results[0].args[0] === 'removed') {
            // TODO no need to create group object and send for delete instead use ID
            _super.db.groups.deleteGroups(subscriptions);
          } else {
            _super.db.groups.addAll(subscriptions);
            for (let i = 0; i < subscriptions.length; i += 1) {
              _super.subscribeToGroup(_super.db.groups.findById(subscriptions[i]._id));
            }
          }
        }
        // check for webrtc
        // [ { _id: 'id',
        // eventName: 'wKk3sXsCYvTkXJeLY/webrtc',
        // args:
        //  [ 'call',
        //    { from: 'xvx4w2hLb29SYXsK4',
        //      room: 'wKk3sXsCYvTkXJeLYxvx4w2hLb29SYXsK4',
        //      media: { audio: true } } ],
        // _version: 3 } ]
        if (results[0].eventName.endsWith('/webrtc')) {
          // console.log('WebRTC updates', results);
          if (results[0].args[0] === 'call') {
            // new incoming call, lets for now show ios call
            // showCallScreen(results[0].args[1]);
          }
        }
      }
    });
    this._monUsers = this.meteor.monitorChanges('users', (results) => {
      if (results && results.length > 0) {
        for (let i = 0; i < results.length; i += 1) {
          _super.db.users.updateFullUserData(results[i]);
        }
      }
    });
  }

  getPublicSettings(callBack) {
    this.meteor.call('public-settings/get', (err, res) => {
      if (err) {
        // console.log(err);
        callBack(null);
      } else {
        const settingsList = {};
        if (res && res.length > 0) {
          for (let i = 0; i < res.length; i += 1) {
            const resdata = res[i];
            settingsList[resdata._id] = resdata;
            if (resdata._id === 'Message_AllowDeleting' && resdata.value) {
              this.deleteAllowed = resdata.value;
            }
            if (resdata._id === 'Message_AllowDeleting_BlockDeleteInMinutes' && resdata.value) {
              this.blockDeleteInMinutes = resdata.value;
            }
          }
        }
        callBack(settingsList);
      }
    });
  }

  canMessageBeDeleted(message) {
//    var deletePermission = false;
    var deleteOwn = false;
    if (this.getCurrentUser() && message && message.u && message.u._id) {
      deleteOwn = (message.u._id === this.getCurrentUser()._id);
    }
//    deletePermission = this.deleteAllowed && deleteOwn;
    // if (this.blockDeleteInMinutes && this.blockDeleteInMinutes !== 0) {
    //   const msgTs = moment(message.ts);
    //   const currentTsDiff = moment().diff(msgTs, 'minutes');
    //   if (currentTsDiff > this.blockDeleteInMinutes) {
    //     return false;
    //   }
    // }
    return deleteOwn;
  }

  /* Need to see if these are required, remove it from db? */
  get loginSettings() {
    return this._loginSettings;
  }

  clearLoginSettings() {
    this._loginSettings = [];
  }

  addLoginSettings(loginDetails) {
    this._loginSettings = this._loginSettings.concat(loginDetails);
  }

  getLoginSetting(key) {
    for (let i = 0; i < this._loginSettings.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(this._loginSettings[i], key)) {
        // @todo: sending just 'saml' is stupidity, need to send the whole array
        return this._loginSettings[i][key];
      }
    }
    return null;
  }

  /* @todo: meteor when called again for login settings, the new subcription still gets old table
   * values - To be fixed
   */
  getLoginSettings() {
    this.clearLoginSettings();
    this.meteor.subscribe('meteor.loginServiceConfiguration');
    this.meteor.monitorChanges('meteor_accounts_loginServiceConfiguration', (results) => {
      this.addLoginSettings(results);
    });
  }

  // use like setPhotoLike('kXLJrEEMKa9WSziPn');
  setPhotoLike(messageId) {
    this.meteor.call('setReaction', ':thumbsup:', messageId, (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

  setOnline() {
    this.meteor.call('setPresence', 'online', (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

  setUserPassword(newPwd, callBack) {
    this.meteor.call('setUserPassword', newPwd, (err) => {
      if (err) {
        callBack(err);
      }
    });
  }


  setUserPresence(presenceStatus) {
    this.meteor.call('UserPresence:setDefaultStatus', presenceStatus, (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

  // set room as read
  setRoomAsRead(groupId) {
    this.meteor.call('readMessages', groupId);
  }

  replyMessage(argGroup, argMessageId, argMsgText) {
    var grptype = 'direct';
    if (argGroup.isPrivate) {
      grptype = 'group';
    } else if (argGroup.isPublic) {
      grptype = 'channel';
    }
    const msgObj = argGroup.findMessageById(argMessageId);
    const replyForMsg = `[ ](${Application.urls.SERVER_URL}/${grptype}/${argGroup.name}?msg=${msgObj._id})`;

    const testMsg = `${replyForMsg} ${argMsgText}`;
    this.meteor.call('sendMessage', {
      rid: argGroup._id, msg: testMsg,
    }, (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

  sendMessage(roomID, msgtoSend) {
    this.meteor.call('sendMessage', {
      rid: roomID, msg: msgtoSend,
    }, (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

    // use like searchUserOrRoom('e');
  searchUserOrRoom(searchKey, callBack) {
    var searchConf = { users: true, rooms: true };
    this.meteor.call('spotlight', searchKey, null, searchConf, (err, res) => {
      if (res) {
        const currUser = this.getCurrentUser();
        if (currUser) {
          const dataUsers = res.users;
          const dataRooms = res.rooms;
          let userKeyToRemove = this.findUserKeyInArray(dataUsers, currUser._id);
          if (userKeyToRemove) {
            res.users.splice(userKeyToRemove, 1);
          }
          if (Application.filterRooms) {
            Object.keys(Application.filterRooms).forEach((k) => {
              const filterRoom = Application.filterRooms[k];
              userKeyToRemove = this.findRoomKeyInArray(dataRooms, filterRoom);
              if (userKeyToRemove) {
                res.rooms.splice(userKeyToRemove, 1);
              }
            });
          }
          callBack(res, 'SUCCESS');
        } else {
          callBack(res, 'FAILURE');
        }
      } else {
        callBack(err, 'FAILURE');
      }
    });
  }

  findRoomKeyInArray(arrayData, filterRoom) {
    var matchKey = null;
    Object.keys(arrayData).forEach((k) => {
      var obj = arrayData[k];
      if (obj.name === filterRoom) {
        matchKey = k;
      }
    });
    return matchKey;
  }

  findUserKeyInArray(arrayData, idToMatch) {
    var matchKey = null;
    Object.keys(arrayData).forEach((k) => {
      var obj = arrayData[k];
      if (obj._id === idToMatch) {
        matchKey = k;
      }
    });
    return matchKey;
  }

  // use like createDirectMessage('ananth');
  createDirectMessage(userName, callBack) {
    this.meteor.call('createDirectMessage', userName, (err, res) => {
      // console.log(err);
      callBack(res, 'SUCCESS');
    });
  }

  // use like createDirectMessage('ananth');
  deleteMessage(msgID, callBack) {
    this.meteor.traceCall('deleteMessage', { _id: msgID }, (err, res) => {
      if (callBack && err) {
        callBack(err, 'FAILURE');
      } else if (callBack) {
        callBack(res, 'SUCCESS');
      }
    });
  }

  joinRoom(roomId, callBack) {
    this.meteor.call('joinRoom', roomId, null, (err, res) => {
      // console.log(err);
      callBack(res, 'SUCCESS');
    });
  }

  createChannel(channelName, isPrivate, isReadonly, userList) {
    var methodName = 'createPrivateGroup';
    if (!isPrivate) {
      methodName = 'createChannel';
    }
    this.meteor.call(methodName, channelName, userList, isReadonly, (/* err, res */) => {
      // console.log(err);
      // console.log(res);
    });
  }

  loginWithSaml(credential) {
    const _super = this;
    setTimeout(() => {
      const loginParams = { saml: true, credentialToken: credential };
      _super.meteor.call('login', loginParams, (err, res) => {
        // console.log('****** login with saml ****');
        // console.log(err);
        // console.log(res);
        if (!err) {
          // lets call login / resume and see if we get the user id
          Meteor._loginWithToken(res.token);
          Application.setUserId(res.id);
          setTimeout(() => {
            // console.log(Meteor.user());
            // console.log(Meteor.userId());
            Actions.app({ type: 'reset' });
          }, 100);
        }
      });
    }, 2000);
  }

  getUserPresence(state) {
    const methodType = `UserPresence:${state}`;
    this.meteor.call(methodType, (/* err */) => {
      // console.log(err);
    });
    // this.meteor.call(methodType, (err, res) => {
    //   // console.log(err);
    // });
  }


  getMembersList(groupId, callBack, onlineUserList) {
    const _super = this;
    const offline = !!onlineUserList;
    this.meteor.call('getUsersOfRoom', groupId, offline, (err, res) => {
      if (res && res.records) {
        for (let i = 0; i < res.records.length; i += 1) {
          // need to have findorupdate with realm  in UM
          let updateStatus = true;
          if (onlineUserList) {
            for (let j = 0; j < onlineUserList.length; j += 1) {
              if (onlineUserList[j]._id === res.records[i]._id) {
                updateStatus = false;
                break;
              }
            }
          }
          if (updateStatus) {
            _super.db.users.updateStatus(
              res.records[i]._id, res.records[i].username, res.records[i].name, offline ? 'offline' : 'online');
          }
        }
        callBack(res, 'SUCCESS');
      } else {
        callBack(err, 'FAILURE');
      }
    });
  }

  getUserAsList(userId) {
    return this.db.users.findByIdAsList(userId);
  }

  getUserByID(userId) {
    return this.db.users.findById(userId);
  }

  findUserByUserName(userName) {
    return this.db.users.findByUserName(userName);
  }

  startVideoCall(rid) {
    this.meteor.call('mgvc:updateTimeout', rid, null);
  }

  searchRoom(roomId, searchText, resultSize, callBack) {
    this.meteor.call('messageSearch', searchText, roomId, resultSize, (err, res) => {
      if (res && res.messages) {
        // duplicate code need to have in a single method and reuse
        const yaps = {};
        for (let i = 0; i < res.messages.length; i += 1) {
          const inM = res.messages[i];
          const m = this.yap2message(inM._id, inM.rid, inM.msg, inM.ts, inM.u._id, inM.u.username, inM.u.name);
          m.original = inM;
          if (inM.attachments && inM.attachments.length > 0) {
            const atM = inM.attachments[0];
            if (m.text === '') {
              if (atM.description) {
                m.text = atM.description;
              } else {
                m.text = atM.text ? atM.text : atM.title;
              }
            }
            if (atM.image_url) {
              m.image = atM.image_url.startsWith('http') ||
              atM.image_url.startsWith('//') ? atM.image_url : `${Application.urls.SERVER_URL}${atM.image_url}`;
              if (inM.file) {
                m.remoteFile = inM.file._id;
              }
            }
          }
          yaps[m._id] = m;
        }
        callBack(yaps, 'SUCCESS');
      } else {
        callBack(err, 'FAILURE');
      }
    });
  }

  logout() {
    this.db.setDBPath(null);
    this.meteor.stopMonitoringChanges(this._monStreamNotifyUser);
    this.meteor.stopMonitoringChanges(this._monUsers);
    this.meteor.stopMonitoringChanges(this._monStreamRoomMessages);
    this.meteor.stopMonitoringChanges(this._monStreamNotifyRoom);
    this.meteor.logout();
  }

  getCurrentUser() {
    var user = this.meteor.getCurrentUser();
    /*
      { _id: '6Qk76sozAy6oNSopT',
      emails: [ { address: 'emailID', verified: true } ],
      username: 'kumar',
      _version: 1 }
    */
    if (user) {
      return this.db.users.findById(user._id);
    }
    return null;
  }

  // TODO unsubscribe after we get data in monitor changes users
  pullFullUserData(userName) {
    this.meteor.subscribe('fullUserData', userName, 1);
  }

  getFilteredChannels(channelList) {
    if (channelList) {
      const filteredList = {};
      Object.keys(channelList).forEach((k) => {
        var obj = channelList[k];
        if (obj.name && Application.filterRooms.indexOf(obj.name) < 0) {
          filteredList[k] = obj;
        }
      });
      return filteredList;
    }
    return null;
  }

  fetchChannels(lastSyncTime) {
    const _super = this;
    // console.log(yap);
    var lastSync = lastSyncTime;
    if (lastSyncTime) {
      lastSync = lastSyncTime.getTime();
    } else {
      const dbAppState = this.db.app.state;
      lastSync = (dbAppState && dbAppState.lastSync) ? dbAppState.lastSync.getTime() : 0;
    }
    // console.log(`Ezhil- Last Sync:${lastSync}, ${lastSyncTime}`);
    // console.log('--- [Network] --- ====================================');
    const noOfMsgs = 10;
    // const temp = lastSync > 0 ? Math.floor(lastSync / 1000) : 0;
    const req1 = this.meteor.traceCall('rooms/get', { $date: lastSync });
    const req2 = this.meteor.call('subscriptions/get', { $date: lastSync });
    Promise.all([req1, req2]).then((results) => {
      // results[0] -  rooms, [1] - subscriptions
      // @todo: move this to util - shallowMerge?
      const rooms = results[0];
      const groups = _super._room2group(results[0]);
      const subscriptions = _super._subscription2group(results[1]);
      Object.keys(groups).forEach((k) => {
        if (k in subscriptions) {
          groups[k] = Object.assign(groups[k], subscriptions[k]);
        }
      });
      // // console.log('Merged:', groups);
      _super.db.groups.addAll(groups);
      Object.keys(rooms).forEach((k) => {
        console.log('Ezhil- rooms[k]._updatedAt ', rooms[k]._updatedAt);
        // lastMessageAt
        if (rooms[k]._id) {
          if (lastSync === 0) {
            const tempGroup = _super.db.groups.findById(rooms[k]._id);
            // console.log(subsResult[k].rid, tempGroup);
            if (tempGroup) {
              _super.fetchMessages(tempGroup, noOfMsgs);
            }
          } else if (new Date(lastSync).getTime() < rooms[k]._updatedAt.getTime()) {
            const tempGroup = _super.db.groups.findById(rooms[k]._id);
            // console.log(subsResult[k]._updatedAt.$date, subsResult[k].rid, tempGroup);
            if (tempGroup) { // if no msgs try to fetch last msg
              _super.fetchMissedMessages(tempGroup, new Date(lastSync));
            }
          }
        }
      });
      this.db.app.setLastSync();
      //      this.fetchAllMessagesFromAllGroups();
    }).catch((/* err */) => {
      // console.log('Catch: ', err);
    });
    this.getUserPresence('online');
  }

  fetchMissedMessages(group, lastSyncTs) {
    const _super = this;
    const gID = group._id;
    // rid, lastMessage.ts
    const req1 = this.meteor.call('loadMissedMessages', gID, lastSyncTs);
    Promise.all([req1]).then((results) => {
      const msgs = results ? results[0] : null;
      _super.yaps2db(group, msgs);
    }).catch((err) => {
      console.log('Catch: ', err);
    });
    this.subscribeToGroup(group);
  }

  // fetch old 'n' messages from a given groupId
  fetchOldMessages(group, n) {
    const _super = this;
    var msgList = group.sortedMessages;
    if (msgList.length > 0) {
      const req1 = this.meteor.call('loadHistory', group._id, msgList[msgList.length - 1].createdAt, n, null);
      Promise.all([req1]).then((results) => {
        // // console.log('Then: ', results);
        // results[0] is from 'loadHistory'
        const msgs = results[0].messages;
        _super.yaps2db(group, msgs);
        if (msgs.length < n) {
          _super.db.groups.updateNoMoreMessages(group);
        }
      }).catch((/* err */) => {
        // console.log('Catch: ', err);
      });
    }
  }

  // fetch 'n' messages from a given groupId
  fetchMessages(group, n) {
    const _super = this;
    const req1 = this.meteor.call('loadHistory', group._id, null, n, null);
    Promise.all([req1]).then((results) => {
      // // console.log('Then: ', results);
      // results[0] is from 'loadHistory'
      const msgs = results[0].messages;
      _super.yaps2db(group, msgs);
      if (msgs.length < n) {
        _super.db.groups.updateNoMoreMessages(group);
      }
    }).catch((/* err */) => {
      // console.log('Catch: ', err);
    });
    this.subscribeToGroup(group);
  }

  // ----- [private] methods -------

  _room2group(inRooms) {
    const groups = {};
    if (inRooms && inRooms.length > 0) {
      for (let i = 0; i < inRooms.length; i += 1) {
        const obj = inRooms[i];
        if (obj.t !== 'l') { // ignore live chat
          let r = { _id: obj._id, name: obj.name, type: obj.t, title: obj.topic };
          r = AppUtil.removeEmptyValues(r);
          groups[r._id] = r;
        }
      }
    }
    return groups;
  }

  _subscription2group(inSubscriptions) {
    const groups = [];
    if (inSubscriptions && inSubscriptions.length > 0) {
      for (let i = 0; i < inSubscriptions.length; i += 1) {
        const obj = inSubscriptions[i];
        if (obj.t !== 'l') { // ignore live chat for now
          let r = { _id: obj.rid, name: obj.name, title: obj.fname, updatedAt: obj._updatedAt, unread: obj.unread };
          r = AppUtil.removeEmptyValues(r);
          if (r._id) {
            groups[r._id] = r;
          }
        }
      }
    }
    return groups;
  }

  // subscribe to all changes in group
  // - to handle deleted, this is tested only for add
  subscribeToGroup(group) {
    if (!Object.prototype.hasOwnProperty.call(this._groupSubsriptionMap, group._id)) {
      this.meteor.subscribe('stream-room-messages', group._id, false); // , function(err, res) {
      this.meteor.subscribe('stream-notify-room', `${group._id}/deleteMessage`, false);
      this._groupSubsriptionMap[group._id] = 'ADDED'; // use set or array instead of map
    }
    //   // console.log("***** room-change:", err);
    //   // console.log("***** room-change:", res);
    // });
  }

  // subscribe for changes from all groups
  subscribeToAllGroups() {
    var groups = this.db.groups.list;
    var _super = this;
    for (let i = 0; i < groups.length; i += 1) {
      this.subscribeToGroup(groups[i]);
    }
    this._monStreamRoomMessages = this.meteor.monitorChanges('stream-room-messages', (results) => {
      if (results && results.length > 0) {
        // group id is the name of the event
        const group = _super.db.groups.findById(results[0].eventName);
        _super.yaps2db(group, results[0].args);
      }
    });
    this._monStreamNotifyRoom = this.meteor.monitorChanges('stream-notify-room', (result) => {
          // message deleed and updated should reflect here
      if (result && result[0] !== undefined) {
        if (result[0].eventName && result[0].eventName.endsWith('/deleteMessage')) {
          const groupId = result[0].eventName.substring(0, result[0].eventName.lastIndexOf('/deleteMessage'));
          this.db.deleteMessage(groupId, result[0].args[0]._id);
        }
      }
    });

    return this._monStreamRoomMessages;
  }

  // fix s3Url
  // pass array of fileIds []
  fixS3Urls(fileIds, callBack, loadNotFromCache) {
    const imageReqs = [];
    var res = [];
    const lookups = {};
    AppUtil.debug(new Date().toLocaleString(), '[Performance] fixS3Urls');
    for (let i = 0; i < fileIds.length; i += 1) {
      const tmpId = fileIds[i];
      const tmp = { fileId: tmpId, url: '' };
      if (loadNotFromCache || !Object.prototype.hasOwnProperty.call(this._cache, tmpId)) {
        const imgReq = new Promise((resolve, reject) => {
          Meteor.call('getS3FileUrl', tmpId, (err, resp) => {
            // @todo: we need to handle deleted message, so for now we are not rejecting promising
            if (err) { // reject(err);
              resolve('');
            }
            resolve(resp);
            // nothing, this would never be called
            reject(resp);
          });
        });
        imageReqs.push(imgReq);
        lookups[imageReqs.length - 1] = i;
      } else {
        tmp.url = this._cache[tmpId];
      }
      res.push(tmp);
    }
    // // console.log(res);
    if (imageReqs.length > 0) {
      // fetch all image urls
      Promise.all(imageReqs).then((results) => {
        // results is an array of [{url:result}, {url:result} ...]
        for (let i = 0; i < results.length; i += 1) {
          const tmp = res[lookups[i]];
          tmp.url = results[i];
          if (!loadNotFromCache) {
            this._cache[tmp.fileId] = tmp.url;
          }
          res[lookups[i]] = tmp;
          // AppUtil.debug(lookups[i]);
          // AppUtil.debug(tmp);
        }
        AppUtil.debug(new Date().toLocaleString(), '[Performance] fixS3Urls - remote lookups');
        AppUtil.debug(res);
        this.db.remotefiles.addAll(this._cache);
        callBack(res);
      }).catch((/* err */) => {
        // console.log('Catch: ', err);
        // need to see if any error we bail out or just leave the failed one
      });
    } else {
      AppUtil.debug(new Date().toLocaleString(), '[Performance] fixS3Urls - NO remote lookups');
      AppUtil.debug(res);
      callBack(res);
    }
  }

  // fix image urls
  fixYapImageUrls(messages, callBack) {
    // process attachments if any
    const imageReqs = [];
    const videoReqs = [];
    const lookups = {};
    const vlookups = {};
    const urlMessages = messages;
    for (let i = 0; i < urlMessages.length; i += 1) {
      const m = urlMessages[i];
      const tmp = Object.assign({}, m);
      const orig = JSON.parse(tmp.original);
      if (orig.attachments && orig.attachments[0].video_url) {
        tmp.video = orig.attachments[0].video_url;
        // dirty fix
//        tmp.image = tmp.video;
        tmp.remoteFile = orig.file._id;
      }
      tmp.user.avatar = `${Application.urls.SERVER_URL}/avatar/${tmp.user.username}?_dc=undefined`;
      urlMessages[i] = tmp;
      if (tmp.remoteFile) {
        if (!tmp.video) {
          imageReqs.push(tmp.remoteFile);  // just save the fileid
          lookups[imageReqs.length - 1] = i;
        } else {
          videoReqs.push(tmp.remoteFile);  // just save the fileid
          vlookups[videoReqs.length - 1] = i;
        }
      }
    }
    if (videoReqs.length > 0) {
      this.fixS3Urls(videoReqs, (results) => {
        // AppUtil.debug(results, 'fixYapImageUrls - result');
        for (let i = 0; i < results.length; i += 1) {
          const tmp = urlMessages[vlookups[i]];
          tmp.image = null;
          tmp.remoteFile = null;
          tmp.video = results[i].url;
          urlMessages[vlookups[i]] = tmp;
        }
        if (imageReqs.length > 0) {
          // fetch all image urls
          this.fixS3Urls(imageReqs, (imgresults) => {
            // AppUtil.debug(results, 'fixYapImageUrls - result');
            for (let i = 0; i < imgresults.length; i += 1) {
              const tmp = urlMessages[lookups[i]];
              tmp.image = imgresults[i].url;
              urlMessages[lookups[i]] = tmp;
            }
            callBack(urlMessages);
          }, false);
        } else {
          callBack(urlMessages);
        }
      }, true);
    } else if (imageReqs.length > 0) {
      // fetch all image urls
      this.fixS3Urls(imageReqs, (results) => {
        // AppUtil.debug(results, 'fixYapImageUrls - result');
        for (let i = 0; i < results.length; i += 1) {
          const tmp = urlMessages[lookups[i]];
          tmp.image = results[i].url;
          urlMessages[lookups[i]] = tmp;
        }
        callBack(urlMessages);
      }, false);
    } else {
      callBack(urlMessages);
    }
  }

  // convert yap message to internal message
  yap2message(id, rid, text, createdAt, userId, userUserName, userName) {
    return { _id: id, rid, text, createdAt, user: { _id: userId, username: userUserName, name: userName } };
  }

  // yap messages from server
  yaps2db(group, msgs) {
    if (!msgs || !group || msgs.length === 0) return;
    const yaps = {};
    const editedYaps = {};
    const currUser = this.getCurrentUser();
    for (let i = 0; i < msgs.length; i += 1) {
      const inM = msgs[i];
      let msgText = inM.msg;
      if (inM.actionLinks && inM.actionLinks[0].method_id === 'joinMGVCCall') {
        msgText = 'Started a Video Call!';
        if (!(inM.u._id === currUser._id)) {
          this.incomingVC(currUser, inM.ts, inM.rid, group);
        }
      }
      const m = this.yap2message(inM._id, inM.rid, msgText, inM.ts, inM.u._id, inM.u.username, inM.u.name);
      m.original = inM;
      if (inM.attachments && inM.attachments.length > 0) {
        const atM = inM.attachments[0];
        if (m.text === '') {
          if (atM.description) {
            m.text = atM.description;
          } else {
            m.text = atM.text ? atM.text : atM.title;
          }
        }
        if (atM.image_url) {
          m.image = atM.image_url.startsWith('http') ||
          atM.image_url.startsWith('//') ? atM.image_url : `${Application.urls.SERVER_URL}${atM.image_url}`;
          if (inM.file) {
            m.remoteFile = inM.file._id;
          }
        }
      }
      m.likes = 0;
      if (inM.reactions) {
        Object.keys(inM.reactions).forEach((key) => {
          if (key.indexOf('thumbsup') >= 0) {
            const tempUsers = inM.reactions[key];
            m.likes = tempUsers.usernames.length;
          }
        });
      }
      if (inM.editedAt || inM.reactions) {
        editedYaps[m._id] = m;
      } else {
        yaps[m._id] = m;
      }
    }
    this.db.addMessages(group, yaps);
    this.db.updateMessages(group, editedYaps);
  }

  incomingVC(currUser, ts, gid, group) {
    if (group && group.type === 'direct') {
      const msgTs = moment(ts);
      const currentTsDiff = moment().diff(msgTs, 'minutes');
      if (currentTsDiff < 1) {
        const vcuserID = currUser ? md5.hex_md5(currUser._id) : '0';
        Actions.directConference({
          instance: Application.instance,
          groupName: group.name,
          groupID: gid,
          groupType: group.type,
          userID: vcuserID,
          callType: 'INCOMING',
        });
      }
    }
  }

}

export default ChatService;
