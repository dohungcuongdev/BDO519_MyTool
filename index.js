const { MongoClient, Long, Binary } = require('mongodb');

// const url = 'mongodb://localhost:27017';
const url = 'mongodb://127.0.0.1:27017';
const client = new MongoClient(url, { useNewUrlParser: true, useUnifiedTopology: true });

const loginServer = 'loginserver';
let lsDb, lsAccounts;

const gameServer = 'gameserver';
let gsDb, gsAccounts, gsPlayers;

async function connectToDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');

        lsDb = client.db(loginServer);
        lsAccounts = lsDb.collection('accounts');

        gsDb = client.db(gameServer);
        gsAccounts = gsDb.collection('accounts');
        gsPlayers = gsDb.collection('players');
    } catch (err) {
        console.error(err);
    }
}

connectToDB();

// AFTER THE UPDATE YOU MAY NEED TO EXIT GAME AND RELOAD YOUR SAVE TO MAKE IT WORK

const express = require('express');
const app = express();
const port = 3000;
app.use(express.json());

// GET ACCOUNTS IN LOGIN SERVER
app.get('/loginserver/accounts', async (req, res) => {
    try {
        let query = {};
        if (Object.keys(req.query).length > 0) {
            query = req.query;
        }
        const accounts = await lsAccounts.find(query).toArray();
        res.status(200).json(accounts);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE ACCESS LEVEL AND CASH BY ACCOUNT NAME
app.patch('/loginserver/accounts/:accountName', async (req, res) => {
    try {
        let updateObject = {};
        if (req.body.cash !== null && req.body.cash !== undefined) {
            updateObject.cash = req.body.cash;
        }
        if (req.body.accessLvl !== null && req.body.accessLvl !== undefined) {
            updateObject.accessLvl = req.body.accessLvl;
        }
        if (Object.keys(updateObject).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update provided' });
        }
        const account = await lsAccounts.findOne({ accountName: req.params.accountName });
        if (!account) {
            res.status(404).json({ error: "Account not found" }); return;
        }
        console.log(updateObject);
        const result = await lsAccounts.updateOne(
            { accountName: req.params.accountName },
            { $set: updateObject }
        );
        if (result.matchedCount > 0) {
            console.log("result.matchedCount: " + result.matchedCount);
            account.cash = updateObject.cash ? updateObject.cash : account.cash;
            account.accessLvl = updateObject.accessLvl ? updateObject.accessLvl : account.accessLvl;
            res.status(200).json(account);
        } else {
            res.status(404).json({ error: 'Account not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// GET ACCOUNTS IN GAME SERVER
app.get('/gameserver/accounts', async (req, res) => {
    try {
        let query = {};
        if (Object.keys(req.query).length > 0) {
            query = req.query; // Assign req.query directly to query object
        }
        const accounts = await gsAccounts.find(query).toArray();
        res.status(200).json(accounts);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// CLONE PLAYER
app.post('/players', async (req, res) => {
    try {
        let name = req.body.name;
        let cloneDataFromName = req.body.cloneDataFromName;

        if (!name || !cloneDataFromName) {
            res.status(400).json({ error: "name & cloneDataFromName are mandatory" }); return;
        }

        const player = await gsPlayers.findOne({ name });
        if (player) {
            res.status(404).json({ error: "player name already existed" }); return;
        }

        const cloneDataFromPlayer = await gsPlayers.findOne({ name: cloneDataFromName });
        if (!cloneDataFromPlayer) {
            res.status(404).json({ error: "no player to clone data" }); return;
        }

        let cloneAppearanceFromName = req.body.cloneAppearanceFromName;
        let cloneAppearanceFromPlayer;
        if (!cloneAppearanceFromName) {
            cloneAppearanceFromPlayer = cloneDataFromPlayer;
        } else {
            cloneAppearanceFromPlayer = await gsPlayers.findOne({ name: cloneAppearanceFromName });
        }
        if (cloneDataFromPlayer.classType != cloneAppearanceFromPlayer.classType) {
            res.status(400).json({ error: "mismatch class type" }); return;
        }

        const accountId = cloneDataFromPlayer.accountId;
        const maxId = await findMaxId(gsPlayers);
        const nextId = BigInt(maxId) + BigInt(1);
        const longId = Long.fromBigInt(nextId);

        const newPlayer = {
            ...cloneDataFromPlayer,
            appearance: cloneAppearanceFromPlayer.appearance,
            name: name,
            _id: longId,
            slot: await findMaxByAccountId('slot', accountId) + 1,
            creationIndex: await findMaxByAccountId('creationIndex', accountId) + 1
        };
        if (cloneDataFromPlayer.memo) {
            newPlayer.memo = cloneDataFromPlayer.memo;
            newPlayer.memo.objectId = longId;
        }
        const result = await gsPlayers.insertOne(newPlayer);
        console.log(result);
        res.status(201).json(newPlayer);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

async function findMaxId(collection) {
    try {
        const maxId = await collection.aggregate([
            { $group: { _id: null, maxId: { $max: '$_id' } } }
        ]).toArray();

        if (maxId.length === 0) {
            throw new Error('No documents found for findMaxId');
        }
        return maxId[0].maxId;
    } catch (err) {
        console.error('Error findMaxId: ', err.message);
        throw err;
    }
}

async function findMaxByAccountId(fieldName, accountId) {
    try {
        const max = await gsPlayers.aggregate([
            { $match: { accountId: accountId } },
            { $group: { _id: null, max: { $max: '$' + fieldName } } }
        ]).toArray();

        if (max.length === 0) {
            throw new Error('No documents found for findMaxFieldByAccountId');
        }

        return max[0].max;
    } catch (err) {
        console.error('Error findMaxFieldByAccountId :', err.message);
        throw err;
    }
}

// GET PLAYERS
app.get('/players', async (req, res) => {
    try {
        res.status(200).json(await getPlayers(req));
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// GET PLAYERS SUMMARY
app.get('/summary/players', async (req, res) => {
    try {
        const players = await getPlayers(req);
        const summaryPlayers = players.map(player => ({
            name: player.name,
            level: player.level,
            classType: player.classType
        }));
        res.status(200).json(summaryPlayers);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

async function getPlayers(req) {
    let query = {};
    if (Object.keys(req.query).length > 0) {
        query = req.query;
    }
    let account;
    if (query.family) {
        account = await lsAccounts.findOne({ family: query.family });
    } else if (query.accountName) {
        account = await lsAccounts.findOne({ accountName: query.accountName });
    }
    if (query.family || query.accountName) {
        if (!account) {
            return [];
        }
        delete query.accountName;
        query.accountId = account._id;
    }
    return await gsPlayers.find(query).toArray();
}

// GET PLAYER
app.get('/players/:name', async (req, res) => {
    try {
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (player) {
            res.status(200).json(player);
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE PLAYER NAME + LEVEL + APPEAREANCE
app.patch('/players/:name', async (req, res) => {
    try {
        let updateObject = {};
        if (req.body.name !== null && req.body.name !== undefined) {
            updateObject.name = req.body.name;
        }
        if (req.body.level !== null && req.body.level !== undefined) {
            updateObject.level = req.body.level;
        }
        let copyAppearanceFromName = req.body.copyAppearanceFromName;
        let copyAppearanceFromPlayer;
        if (copyAppearanceFromName && req.body.name != copyAppearanceFromName) {
            copyAppearanceFromPlayer = await gsPlayers.findOne({ name: copyAppearanceFromName });
            if (copyAppearanceFromPlayer) {
                updateObject.appearance = copyAppearanceFromPlayer.appearance
            }
        }
        if (Object.keys(updateObject).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update provided' });
        }
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (!player) {
            res.status(404).json({ error: "Player not found" }); return;
        }
        if (copyAppearanceFromName && req.body.name != copyAppearanceFromName) {
            if (player.classType != copyAppearanceFromPlayer.classType) {
                res.status(500).json({ error: "mismatch class type" }); return;
            }
            const playerNewName = await gsPlayers.findOne({ name: updateObject.name });
            if (playerNewName && req.params.name != updateObject.name) {
                res.status(409).json({ error: "new player name already existed" }); return;
            }
        }

        console.log(updateObject);
        const result = await gsPlayers.updateOne(
            { name: req.params.name },
            { $set: updateObject }
        );
        if (result.matchedCount > 0) {
            console.log("result.matchedCount: " + result.matchedCount);
            player.name = updateObject.name ? updateObject.name : player.name;
            player.level = updateObject.level ? updateObject.level : player.level;
            player.appearance = updateObject.appearance ? updateObject.appearance : player.appearance;
            res.status(200).json(player);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE PLAYER
app.delete('/players/:name', async (req, res) => {
    try {
        const result = await gsPlayers.deleteOne({ name: req.params.name });
        if (result.deletedCount > 0) {
            res.status(200).json({ deletedCount: result.deletedCount });
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET QUESTS OF PLAYER
app.get('/players/:name/quests', async (req, res) => {
    try {
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (player) {
            res.status(200).json(getQuests(player));
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// COMPLETE QUESTS OF PLAYER
app.post('/players/:name/quests', async (req, res) => {
    try {
        const completeAll = req.query.completeAll;
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (player) {
            let toFinishQuests = req.body;
            const quests = getQuests(player);
            if (completeAll) {
                toFinishQuests = quests.progressQuestList;
            }
            if (!toFinishQuests || toFinishQuests.length === 0 || !Array.isArray(toFinishQuests)) {
                res.status(200).json(quests); return;
            }
            let clearedQuestList = quests.clearedQuestList;
            quests.progressQuestList.forEach(item => {
                const exist = toFinishQuests.some(targetItem =>
                    targetItem.groupId === item.groupId && targetItem.questId === item.questId
                );
                if (exist) {
                    clearedQuestList.push({
                        groupId: item.groupId,
                        questId: item.questId,
                        completedTime: 0
                    });
                }
            });
            let progressQuestList = player.quests.progressQuestList.filter(item => {
                return !toFinishQuests.some(targetItem =>
                    targetItem.groupId === item.groupId && targetItem.questId === item.questId
                );
            });

            let checkedQuestData = progressQuestList.map(item => `${item.groupId},${item.questId}`).join(',');
            await gsPlayers.updateOne(
                { name: req.params.name },
                {
                    $set: {
                        "quests.checkedQuestData": encodeCheckedQuestData(checkedQuestData),
                        "quests.progressQuestList": progressQuestList,
                        "quests.clearedQuestList": clearedQuestList
                    }
                }
            );

            const playerUpdated = await gsPlayers.findOne({ name: req.params.name });
            res.status(200).json(getQuests(playerUpdated));
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE QUESTS OF PLAYER
app.put('/players/:name/quests', async (req, res) => {
    try {
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (player) {
            let progressQuestList = req.body.progressQuestList;
            let clearedQuestList = req.body.clearedQuestList;
            if (!progressQuestList || !clearedQuestList) {
                res.status(400).json({ error: "progressQuestList and clearedQuestList are mandatory" }); return;
            }
            progressQuestList = progressQuestList.map(item => {
                return {
                    ...item,
                    acceptedTime: item.acceptedTime ? item.acceptedTime : new Date().getTime(),
                    steps: item.steps ? item.steps : [0, 0, 0, 0, 0]
                }
            });
            clearedQuestList = clearedQuestList.map(item => {
                return {
                    ...item,
                    completedTime: item.completedTime ? item.completedTime : 0
                }
            });
            let checkedQuestData = progressQuestList.map(item => `${item.groupId},${item.questId}`).join(',');
            await gsPlayers.updateOne(
                { name: req.params.name },
                {
                    $set: {
                        "quests.checkedQuestData": encodeCheckedQuestData(checkedQuestData),
                        "quests.progressQuestList": progressQuestList,
                        "quests.clearedQuestList": clearedQuestList
                    }
                }
            );

            const playerUpdated = await gsPlayers.findOne({ name: req.params.name });
            res.status(200).json(getQuests(playerUpdated));
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// BY PASS BUGGED QUEST
app.patch('/players/:name/quests', async (req, res) => {
    try {
        const player = await gsPlayers.findOne({ name: req.params.name });
        if (player) {
            const groupId = req.body.groupId;
            const questId = req.body.questId;
            const steps = req.body.steps;
            if (!groupId || !questId) {
                res.status(400).json({ error: "groupId and questId are mandatory" }); return;
            }
            let progressQuestList = player.quests.progressQuestList;
            for (let i = 0; i < progressQuestList.length; i++) {
                if (progressQuestList[i].groupId === groupId && progressQuestList[i].questId === questId) {
                    progressQuestList[i].steps = steps ? steps : [1, 0, 0, 0, 0];
                    break;
                }
            }
            let updateObject = {
                "quests.progressQuestList": progressQuestList
            }
            await gsPlayers.updateOne(
                { name: req.params.name },
                { $set: updateObject }
            );
            const playerUpdated = await gsPlayers.findOne({ name: req.params.name });
            res.status(200).json(getQuests(playerUpdated));
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

function getQuests(player) {
    // const checkedQuestData = player.quests.checkedQuestData;
    // const progressQuestList = player.quests.progressQuestList.map(item => ({
    //     groupId: item.groupId,
    //     questId: item.questId,
    //     acceptedTime: item.acceptedTime,
    //     acceptedDateTime: formatDateTime(item.acceptedTime)
    // }));
    // const clearedQuestList = player.quests.clearedQuestList.map(item => ({
    //     groupId: item.groupId,
    //     questId: item.questId
    // }));
    // return { checkedQuestData, progressQuestList, clearedQuestList }
    return player.quests;
}


function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString(); // Adjust the format as needed
}

function encodeCheckedQuestData(checkedQuestData) {
    // Convert string to Buffer with utf8 encoding
    let buffer = Buffer.alloc(402, 0);

    // Convert the checkedQuestData string to a buffer
    const checkedQuestDataBuffer = Buffer.from(checkedQuestData, 'utf8');

    // Copy the checkedQuestData buffer into the beginning of the 402-byte buffer
    checkedQuestDataBuffer.copy(buffer);

    // Return MongoDB Binary object
    return new Binary(buffer, Binary.SUBTYPE_DEFAULT);
}

// COPY STAGE OF PLAYER
app.post('/players/:name/stages', async (req, res) => {
    try {
        const copyStageFromName = req.body.copyStageFromName
        if (!copyStageFromName) {
            res.status(400).json({ error: "copyStageFromName is mandatory" }); return;
        }

        const name = req.params.name;
        const player = await gsPlayers.findOne({ name });
        if (player) {
            const copyStageFromPlayer = await gsPlayers.findOne({ name: copyStageFromName });
            if (!copyStageFromPlayer) {
                res.status(404).json({ error: 'copyStageFromPlayer not found' }); return;
            }
            if (player._id == copyStageFromPlayer._id) {
                res.status(200).json(player); return;
            }
            const sameClass = player.classType == copyStageFromPlayer.classType;
            const memo = {
                ...copyStageFromPlayer.memo,
                objectId: player._id
            }
            let equipments = { ...copyStageFromPlayer.playerBag.Equipments }
            let eqItems = player.playerBag.Equipments.items;
            let copyEqItems = copyStageFromPlayer.playerBag.Equipments.items;
            if (!sameClass && eqItems.length >= 2 && copyEqItems.length >= 2) {
                let sortedEqItems = sort(eqItems);
                let sortedCopyEqItems = sort(copyEqItems);
                sortedCopyEqItems[0] = sortedEqItems[0];
                sortedCopyEqItems[1] = sortedEqItems[1];
                equipments.items = sortedCopyEqItems.filter(item => item.price > 0);
                for (let item of sortedEqItems) {
                    let exists = equipments.items.some(it => it.index === item.index);
                    if (!exists && item.price == 0) {
                        equipments.items.push(item);
                    }
                }
            }
            const playerBag = {
                ...copyStageFromPlayer.playerBag,
                Equipments: equipments
            }
            const playerAvailableSkillPoints = player.skillList.availableSkillPoints;
            const playerTotalSkillPoints = player.skillList.totalSkillPoints;
            const copyTotalSkillPoints = copyStageFromPlayer.skillList.totalSkillPoints;
            let resultAvailableSkillPoints = playerAvailableSkillPoints + (copyTotalSkillPoints - playerTotalSkillPoints);
            if (resultAvailableSkillPoints < 0) resultAvailableSkillPoints = 0;
            const skillList = {
                ...copyStageFromPlayer.skillList,
                skills: sameClass ? copyStageFromPlayer.skillList.skills : player.skillList.skills,
                availableSkillPoints: sameClass ? copyStageFromPlayer.skillList.availableSkillPoints : resultAvailableSkillPoints
            }
            let updateObject = {
                level: copyStageFromPlayer.level,
                exp: copyStageFromPlayer.exp,
                tendency: copyStageFromPlayer.tendency,
                currentWp: copyStageFromPlayer.currentWp,
                journal: copyStageFromPlayer.journal,
                location: copyStageFromPlayer.location,
                quests: copyStageFromPlayer.quests,
                lifeStats: copyStageFromPlayer.lifeStats,
                fitness: copyStageFromPlayer.fitness,
                memo,
                playerBag,
                skillList
            }
            await gsPlayers.updateOne(
                { name: name },
                { $set: updateObject }
            );
            const playerUpdated = await gsPlayers.findOne({ name });
            res.status(200).json(playerUpdated);
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

function sort(items) {
    return items.sort((a, b) => a.index - b.index);
}

// CORRECT SKILL POINTS
app.patch('/players/:name/correctSkillPoints', async (req, res) => {
    try {
        const name = req.params.name;
        const player = await gsPlayers.findOne({ name });
        if (player) {
            let updateObject = {}
            if (req.body.skillExpLevel) updateObject["skillList.skillExpLevel"] = req.body.skillExpLevel;
            if (req.body.totalSkillPoints) updateObject["skillList.totalSkillPoints"] = req.body.totalSkillPoints;
            if (req.body.availableSkillPoints) updateObject["skillList.availableSkillPoints"] = req.body.availableSkillPoints;
            if (req.body.currentSkillPointsExp) updateObject["skillList.currentSkillPointsExp"] = req.body.currentSkillPointsExp;
            await gsPlayers.updateOne(
                { name: name },
                { $set: updateObject }
            );
            const playerUpdated = await gsPlayers.findOne({ name });
            res.status(200).json(playerUpdated);
        } else {
            res.status(404).json({ error: 'player not found' });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});


// DOWNLOAD DATA ON SERVER
const fs = require('fs-extra');
const archiver = require('archiver');
const path = require('path');
app.get('/downloadServerData', async (req, res) => {
    const folderPath = req.query.folderPath ? req.query.folderPath : 'C:/work/freetime/game/BDO519/Database/data';
    const zipFileName = 'data.zip';
    const zipFilePath = path.join(__dirname, zipFileName);

    console.log("zipping data");

    // Create a zip archive of the folder
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', () => {
        console.log(archive.pointer() + ' total bytes');
        console.log('archiver has been finalized and the output file descriptor has closed.');

        // Ensure headers are set only once
        if (!res.headersSent) {
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', `attachment; filename=${zipFileName}`);
            res.sendFile(zipFilePath, (err) => {
                if (err) {
                    console.log('Error sending file:', err);
                    res.status(500).json({ error: err });
                } else {
                    // Optionally delete the file after sending
                    fs.unlink(zipFilePath, (err) => {
                        if (err) {
                            console.log('Error deleting zip file:', err);
                        } else {
                            console.log('Zip file deleted successfully');
                        }
                    });
                }
            });
        }
    });

    output.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    });

    archive.on('error', (err) => {
        console.error('Archiver error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    });

    archive.pipe(output);
    archive.directory(folderPath, false);

    try {
        await archive.finalize();
    } catch (err) {
        console.error('Error in /downloadServerData:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

app.listen(port, () => {
    console.log(`API listening at http://localhost:${port}`);
});
