const buf = buffer;
const { Buff } = window.buffUtils;
const { Address, Script, Signer, Tap, Tx } = window.tapscript

let db;
let active_plugin = null;
let $ = document.querySelector.bind(document);
let $$ = document.querySelectorAll.bind(document);
let url_params = new URLSearchParams(window.location.search);
let url_keys = url_params.keys();
let $_GET = {}
for (let key of url_keys) $_GET[key] = url_params.get(key);

// no changes from here
let privkey = bytesToHex(cryptoUtils.Noble.utils.randomPrivateKey());
let pushing = false;
let files = [];

sessionStorage.clear();

let slider = document.getElementById("sats_range");
let output = document.getElementById("sats_per_byte");
output.innerHTML = slider.value;
slider.oninput = function () {
    output.innerHTML = this.value;
    sessionStorage["feerate"] = this.value;
    $$('.fee .num').forEach(function (item) {
        item.style.backgroundColor = "grey";
    });
}

let inscriptions_manually = false;

window.onload = async function () {

    $('#padding').value = padding;
    $('.text').onclick = showText;
    $('.upload_file').onclick = showUploader;
    $('.registration').onclick = showRegister;
    $('.unisat').onclick = showUnisat;
    $('.brc20_mint').onclick = showBrc20Mint;
    $('.brc20_deploy').onclick = showBrc20Deploy;
    $('.brc20_transfer').onclick = showBrc20Transfer;
    $('#backup-usage').onclick = showBackupUsage;
    $('#tip').onfocus = async function(){

        this.value = '';
    };
    $('#tip').onkeyup = async function(){

        let tip = $('#tip').value.replace(/[^0-9]/g, '');

        if(isNaN(parseInt($('#tip').value)) || parseInt(tip) < 0){

            $('#tip').value = '';
        }

        $('#tip-usd').innerHTML = Number(await satsToDollars(tip)).toFixed(2);
    };

    $('#cpfp').onclick = async function(){

        if(!$('#cpfp').checked)
        {
            $('#turbo').checked = false;
        }
    }

    $('#turbo').onclick = async function(){

        if(!$('#cpfp').checked && $('#turbo').checked)
        {
            alert('Please enable CPFP first.');
            $('#turbo').checked = false;
            return;
        }

        if($('#turbo').checked)
        {
            alert("WARNING: turbo mode is expensive. Only recommended if you are in a hurry and the fees are high.\nOnly available with CPFP enabled.");
        }
    }

    await initDatabase();

    let quota = await insQuota();
    let usage = Math.round(( (quota.usage/quota.quota) + Number.EPSILON) * 10000) / 10000;
    $('#db-quota').innerHTML = usage + '%';

    setInterval(async function(){

        let quota = await insQuota();
        let usage = Math.round(( (quota.usage/quota.quota) + Number.EPSILON) * 10000) / 10000;
        $('#db-quota').innerHTML = usage + '%';

    }, 5000);

    loadPlugins();

    try
    {
        await fetch('https://www3.doubleclick.net', {
            method: "HEAD",
            mode: "no-cors",
            cache: "no-store",
        });

        let adBoxEl = document.querySelector(".ad-box")
        let hasAdBlock = window.getComputedStyle(adBoxEl)?.display === "none"

        if(hasAdBlock)
        {
            throw new Error('Adblock detected');
        }
    }
    catch (e)
    {
        alert('To make sure inscribing will work properly, disable all adblockers for this app. If you use brave, turn off its shield.' + "\n\n" + 'We do NOT place ads nor will we track you.');
    }
};

async function showBackupUsage()
{
    if($('#backup-list').style.display == 'none')
    {
        $('#backup-list').style.display = 'block';

        let html = '';
        let keys = await insGetAllKeys();

        for(let i = 0; i < keys.length; i++)
        {
            let date = await insDateGet(keys[i]);
            html += '<div style="font-size: 14px;" id="backup-item-'+keys[i]+'">[<a href="javascript:void(0);" onclick="startInscriptionRecovery(\''+keys[i]+'\')" style="font-size: 14px;">recover</a>] [<a href="javascript:void(0);" onclick="deleteInscription(\''+keys[i]+'\')" style="font-size: 14px;">delete</a>] '+date+'<hr/></div>';
        }

        $('#backup-list').innerHTML = html;
    }
    else
    {
        $('#backup-recovery').style.display = 'none';
        $('#backup-list').style.display = 'none';
        $('#backup-list').innerHTML = '';
    }
}

async function deleteInscription(key){

    let result = confirm('Are you sure you want to delete this backup entry? If you are not sure, check if there is anything to recover first.');

    if(result)
    {
        await insDelete(key);
        await insDateDelete(key);
        $('#backup-item-'+key).remove();
    }
}

async function startInscriptionRecovery(key) {


    $('#backup-recovery').innerHTML = '<div id="recovery-info">Please wait, searching for UTXOs<span class="dots">.</span></div>';
    $('#backup-recovery').style.display = 'block';

    let utxos_found = false;
    let processed = [];
    let tx = JSON.parse(await insGet(key));

    let cursed = '';

    for (let i = 0; i < tx.length; i++) {

        if(tx[i].txsize == '326' || ( typeof tx[i].cursed != 'undefined' && tx[i].cursed ) )
        {
            cursed = tx[i].output.scriptPubKey[1];
            break;
        }
    }

    for (let i = 0; i < tx.length; i++) {

        if(!Array.isArray(tx[i].output.scriptPubKey))
        {
            if(tx[i].output.scriptPubKey.startsWith('5120'))
            {
                tx[i].output.scriptPubKey = tx[i].output.scriptPubKey.slice(4);
            }

            tx[i].output.scriptPubKey = ['OP_1', tx[i].output.scriptPubKey];
        }

        let plainTapKey = tx[i].output.scriptPubKey[1];

        if (processed.includes(plainTapKey)) {

            continue;
        }

        if(cursed != '' && cursed == plainTapKey)
        {
            continue;
        }

        let response = null;

        /*
        if(encodedAddressPrefix == 'main') {

            response = await getData('https://mem-api.ordapi.xyz/utxo/' + Address.p2tr.encode(plainTapKey, encodedAddressPrefix));
        }*/

        if(response === null || response.toLowerCase().includes('not found') || response.toLowerCase().includes('error') || response.toLowerCase().includes('too many requests') || response.toLowerCase().includes('bad request')) {

            response = await getData('https://mempool.space/'+mempoolNetwork+'api/address/' + Address.p2tr.encode(plainTapKey, encodedAddressPrefix) + '/utxo');
        }

        let utxos = JSON.parse(response);
        let utxo = null;

        for (let j = 0; j < utxos.length; j++) {

            utxo = utxos[j];

            if (utxo !== null) {
                utxos_found = true;
                $('#recovery-info').style.display = 'none';
                $('#backup-recovery').innerHTML += '<div id="recovery-item-' + key + '-'+utxo.vout+'" style="font-size: 14px;">Found UTXO with ' + utxo.value + ' sats [<a style="font-size: 14px;" href="javascript:void(0);" onclick="recover(' + i + ', ' + utxo.vout + ', $(\'#taproot_address\').value, \'' + key + '\')">recover</a>]</div>';
                $('#backup-recovery').innerHTML += '<hr/>';
            }
        }

        processed.push(plainTapKey);

        await sleep(3000);
    }

    if(!utxos_found)
    {
        $('#backup-recovery').innerHTML = '<div id="recovery-info">No UTXOs found</div>';
    }
}

function showUnisat() {
    $('#padding').value = '546';
    padding = '546';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.dns').value = "";
    $('.unisat_form').style.display = "block";
    $('.unisat_checker').style.display = "block";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.add('active');
    document.getElementById('text_nav').classList.remove('active');
}

function showText() {
    $('#padding').value = '546';
    padding = '546';
    files = [];

    let cloned = $$('.text_area')[0].cloneNode(true);
    cloned.value = '';
    $('#form_container').innerHTML = '';
    document.getElementById("form_container").appendChild(cloned);

    $('#text-addrow').style.display = 'none';

    $('#app-form').reset();
    $('.text_form').style.display = "inline";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.dns').value = "";
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.add('active');
}

function showRegister() {
    $('#padding').value = '546';
    padding = '546';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "block";
    $('.dns_checker').style.display = "inline";
    $('.dns').value = "";
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.add('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.remove('active');
}

function showUploader() {
    $('#padding').value = '10000';
    padding = '10000';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "block";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.add('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.remove('active');
}

function showBrc20Deploy() {
    $('#padding').value = '546';
    padding = '546';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "block";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.registration').onclick = showRegister;
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.add('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.remove('active');
}

function showBrc20Mint() {
    $('#padding').value = '546';
    padding = '546';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "block";
    $('.brc20_transfer_form').style.display = "none";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.registration').onclick = showRegister;
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.add('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.remove('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.remove('active');
}

function showBrc20Transfer() {
    $('#padding').value = '546';
    padding = '546';
    files = [];
    $('#app-form').reset();
    $('.text_form').style.display = "none";
    $('.brc20_deploy_form').style.display = "none";
    $('.brc20_mint_form').style.display = "none";
    $('.brc20_transfer_form').style.display = "block";
    $('.file_form').style.display = "none";
    $('.dns_form').style.display = "none";
    $('.dns_checker').style.display = "none";
    $('.registration').onclick = showRegister;
    $('.unisat_form').style.display = "none";
    $('.unisat_checker').style.display = "none";
    $('.unisat').value = "";
    $('#plugin_form').style.display = 'none';
    $$('.options a').forEach(function(item){
        item.classList.remove('active');
    });
    active_plugin = null;
    document.getElementById('brc20_mint_nav').classList.remove('active');
    document.getElementById('brc20_deploy_nav').classList.remove('active');
    document.getElementById('brc20_transfer_nav').classList.add('active');
    document.getElementById('upload_file_nav').classList.remove('active');
    document.getElementById('registration_nav').classList.remove('active');
    document.getElementById('unisat_nav').classList.remove('active');
    document.getElementById('text_nav').classList.remove('active');

    $('#brc-transfer-container').innerHTML = '<div class="brc-transfer-block">' + $$('.brc-transfer-block')[0].innerHTML + '</div>';

    async function addTransferBlock(e)
    {
        e.preventDefault();
        let div = document.createElement('div');
        div.classList.add('brc-transfer-block');
        div.innerHTML = '<hr/>' + '<div class="brc-transfer-block">' + $$('.brc-transfer-block')[0].innerHTML + '</div>';
        $('#brc-transfer-container').appendChild(div);
        return false;
    }

    $('#add_transfer_button').onclick = addTransferBlock;
}

showUploader();

$('.form').addEventListener("change", async function () {

    files = [];

    let limit_reached = 0;

    for (let i = 0; i < this.files.length; i++) {

        let b64;
        let mimetype = this.files[i].type;

        if (mimetype.includes("text/plain")) {

            mimetype += ";charset=utf-8";
        }

        if (this.files[i].size >= 350000) {

            limit_reached += 1;

        } else {

            b64 = await encodeBase64(this.files[i]);
            let base64 = b64.substring(b64.indexOf("base64,") + 7);
            let hex = base64ToHex(base64);

            //console.log( "hex:", hex );
            //console.log( "bytes:", hexToBytes( hex ) );

            console.log(this.files[i]);

            let sha256 = await fileToSha256Hex(this.files[i]);
            files.push({
                name: this.files[i].name,
                hex: hex,
                mimetype: mimetype,
                sha256: sha256.replace('0x', '')
            });
        }
    }

    if (limit_reached != 0) {
        alert(limit_reached + " of your desired inscriptions exceed(s) the maximum of 350kb.")
    }

    console.log(files);
});

$('.startover').addEventListener("click", async function () {

    location.reload();
});

$('.estimate').addEventListener("click", async function () {

    run(true);
});

$('.submit').addEventListener("click", async function () {

    run(false);
});

async function run(estimate) {

    if (!estimate && !isValidAddress()) {
        alert('Invalid taproot address.');
        return;
    }

    let mempool_success = await probeAddress($('.address').value, true);

    if (!estimate && !mempool_success) {
        alert('Could not establish a connection to Mempool.space. Most likely you got rate limited. Please wait a few minutes before you try inscribing.');
        return;
    }

    if ($('.brc20_deploy_form').style.display != "none") {

        files = [];

        let deploy = '{ \n' +
            '  "p": "brc-20",\n' +
            '  "op": "deploy",\n' +
            '  "tick": "",\n' +
            '  "max": "",\n' +
            '  "lim": ""\n' +
            '}';

        if (isNaN(parseInt($('#brc20-deploy-max').value))) {
            alert('Invalid supply.');
            return;
        }

        if (isNaN(parseInt($('#brc20-deploy-lim').value))) {
            alert('Invalid limit.');
            return;
        }

        if ($('#brc20-deploy-ticker').value == '' || $('#brc20-deploy-ticker').value.length < 2) {
            alert('Invalid ticker length. Must be at least 2 characters.');
            return;
        }

        deploy = JSON.parse(deploy);
        deploy.tick = $('#brc20-deploy-ticker').value;
        deploy.max = $('#brc20-deploy-max').value;
        deploy.lim = $('#brc20-deploy-lim').value;

        let mimetype = "text/plain;charset=utf-8";
        files.push({text: JSON.stringify(deploy), name: deploy.tick, hex: textToHex(JSON.stringify(deploy)), mimetype: mimetype, sha256: ''});

        console.log(files);
    }

    if ($('.brc20_transfer_form').style.display != "none") {

        files = [];

        let _transfer = '{ \n' +
            '  "p": "brc-20",\n' +
            '  "op": "transfer",\n' +
            '  "tick": "",\n' +
            '  "amt": ""\n' +
            '}';

        let transfers = $$('.brc20-transfer-amount');
        let tickers = $$('.brc20-transfer-ticker');

        for(let i = 0; i < transfers.length; i++)
        {

            if (isNaN(parseInt(transfers[i].value))) {
                alert('Invalid transfer amount at ticker #' + (i+1));
                return;
            }

            if (tickers[i].value == '' || tickers[i].value.length < 2) {
                alert('Invalid ticker length. Must be at least 2 characters at ticker #' + (i+1));
                return;
            }

            let transfer = JSON.parse(_transfer);
            transfer.tick = tickers[i].value;
            transfer.amt = transfers[i].value;

            let mimetype = "text/plain;charset=utf-8";
            files.push({text: JSON.stringify(transfer), name: transfer.tick, hex: textToHex(JSON.stringify(transfer)), mimetype: mimetype, sha256: ''});
        }

        console.log(files);
    }

    if ($('.brc20_mint_form').style.display != "none") {

        files = [];

        let mint = '{ \n' +
            '  "p": "brc-20",\n' +
            '  "op": "mint",\n' +
            '  "tick": "",\n' +
            '  "amt": ""\n' +
            '}';

        if (isNaN(parseInt($('#brc20-mint-amount').value))) {
            alert('Invalid mint amount.');
            return;
        }

        if ($('#brc20-mint-ticker').value == '' || $('#brc20-mint-ticker').value.length < 2) {
            alert('Invalid ticker length. Must be at least 2 characters.');
            return;
        }

        mint = JSON.parse(mint);
        mint.tick = $('#brc20-mint-ticker').value;
        mint.amt = $('#brc20-mint-amount').value;

        let repeat = parseInt($('#brc20-mint-repeat').value);

        if (isNaN(repeat)) {
            alert('Invalid repeat amount.');
            return;
        }

        for (let i = 0; i < repeat; i++) {
            let mimetype = "text/plain;charset=utf-8";
            files.push({
                text: JSON.stringify(mint),
                name: mint.tick + '_' + i,
                hex: textToHex(JSON.stringify(mint)),
                mimetype: mimetype,
                sha256: ''
            });
        }

        console.log(files);
    }

    if ($('.unisat_form').style.display != "none") {

        files = [];

        let sats_domains = $('.unisat_text').value.split("\n");
        let sats_domains_cleaned = [];

        for (let sats_domain in sats_domains) {

            let domain = sats_domains[sats_domain].trim();

            if (domain == '' || sats_domains_cleaned.includes(domain)) {

                continue;
            }

            let splitted = domain.split('.');

            if(splitted.length == 1 || splitted[splitted.length - 1].toLowerCase() != 'unisat')
            {
                alert('Invalid unisat domain: ' + domain);
                return;
            }

            sats_domains_cleaned.push(domain);
        }

        for (let sats_domain in sats_domains_cleaned) {

            let mimetype = "text/plain;charset=utf-8";
            let domain = {"p": "sns", "op": "reg", "name": sats_domains_cleaned[sats_domain].trim()};
            files.push({
                text: JSON.stringify(domain),
                name: sats_domains_cleaned[sats_domain].trim(),
                hex: textToHex(JSON.stringify(domain)),
                mimetype: mimetype,
                sha256: ''
            });
            console.log(domain);
        }
    }

    if ($('.dns_form').style.display != "none") {

        files = [];

        let sats_domains = $('.dns').value.split("\n");
        let sats_domains_cleaned = [];

        for (let sats_domain in sats_domains) {

            let domain = sats_domains[sats_domain].trim();

            if (domain == '' || sats_domains_cleaned.includes(domain)) {

                continue;
            }

            let splitted = domain.split('.');

            if(splitted.length == 1 || splitted[splitted.length - 1].toLowerCase() != 'sats')
            {
                alert('Invalid sats domain: ' + domain);
                return;
            }

            sats_domains_cleaned.push(domain);
        }

        for (let sats_domain in sats_domains_cleaned) {

            let mimetype = "text/plain;charset=utf-8";
            let domain = {"p": "sns", "op": "reg", "name": sats_domains_cleaned[sats_domain].trim()};
            files.push({
                text: JSON.stringify(domain),
                name: sats_domains_cleaned[sats_domain].trim(),
                hex: textToHex(JSON.stringify(domain)),
                mimetype: mimetype,
                sha256: ''
            });
            console.log(domain);
        }
    }

    if ($('.text_form').style.display != "none") {

        let repeat = parseInt($('#text-repeat').value);

        if (isNaN(repeat)) {
            alert('Invalid repeat amount.');
            return;
        }

        files = [];

        if(!$('#text-multirow').checked)
        {
            let text = $$('.text_area')[0];
            let rows = text.value.split("\n");

            for(let i = 0; i < rows.length; i++)
            {
                let value = rows[i].trim();

                if (value != '') {
                    let mimetype = "text/plain;charset=utf-8";
                    files.push({
                        text: JSON.stringify(value),
                        name: textToHex(value),
                        hex: textToHex(value),
                        mimetype: mimetype,
                        sha256: ''
                    });
                }
            }
        }
        else
        {
            let texts = $$('.text_area');

            texts.forEach(function (text) {

                if (text.value.trim() != '') {
                    let mimetype = "text/plain;charset=utf-8";
                    files.push({
                        text: JSON.stringify(text.value),
                        name: textToHex(text.value),
                        hex: textToHex(text.value),
                        mimetype: mimetype,
                        sha256: ''
                    });
                }
            });
        }

        let newFiles = [];

        for (let i = 0; i < repeat; i++) {

            for (let j = 0; j < files.length; j++) {

                newFiles.push(files[j]);
            }
        }

        files = newFiles;

        console.log(files);
    }

    if(active_plugin !== null)
    {
        let plugin_result = await active_plugin.instance.prepare();

        if(plugin_result === false)
        {
            return;
        }
    }

    if (files.length == 0) {
        alert('Nothing to inscribe. Please upload some files or use one of the additional options.');
        return;
    }

    if (files.length > 10000) {
        alert('Max. batch size is 10,000. Please remove some of your inscriptions and split them into many batches.');
        return;
    }

    let is_bin = files[0].sha256 != '' ? true : false;
    let min_padding = !is_bin ? 546 : 1000;
    let _padding = parseInt($('#padding').value);

    if (!isNaN(_padding) && _padding <= Number.MAX_SAFE_INTEGER && _padding >= min_padding) {
        padding = _padding;
    } else {
        alert('Invalid padding. Please enter at minimum ' + min_padding + ' sats amount for each inscription.');
        return;
    }

    let tip_check = parseInt($('#tip').value);
    tip_check = isNaN(tip_check) ? 0 : tip_check;

    let cursed_multiplier_tip = 1;

    if($('#cursed').checked)
    {
        cursed_multiplier_tip = 2;
    }

    if(active_plugin === null)
    {

        if(!estimate && tip_check < 500 * files.length * cursed_multiplier_tip)
        {
            $('#tip').value = 500 * files.length * cursed_multiplier_tip;
            $('#tip-usd').innerHTML = Number(await satsToDollars($('#tip').value)).toFixed(2);
            alert('Minimum tipping is ' + (500 * files.length * cursed_multiplier_tip) + ' sats based on your bulk amount. A suggestion has been added to the tip.');
            return;
        }
    }
    else
    {
        let plugin_tip = await active_plugin.instance.tip();

        if(!estimate && tip_check < plugin_tip * cursed_multiplier_tip)
        {
            $('#tip').value = plugin_tip * cursed_multiplier_tip;
            $('#tip-usd').innerHTML = Number(await satsToDollars($('#tip').value)).toFixed(2);
            alert('Minimum tipping has been set to ' + ( plugin_tip * cursed_multiplier_tip ) + ' sats based on your inscriptions. A suggestion has been added to the tip.');
            return;
        }
    }

    const KeyPair = cryptoUtils.KeyPair;

    let seckey = new KeyPair(privkey);
    let pubkey = seckey.pub.rawX;

    const ec = new TextEncoder();

    const init_script = [
        pubkey,
        'OP_CHECKSIG'
    ];

    const init_script_backup = [
        '0x' + buf2hex(pubkey.buffer),
        'OP_CHECKSIG'
    ];

    let init_leaf = await Tap.tree.getLeaf(Script.encode(init_script));
    let [init_tapkey, init_cblock] = await Tap.getPubKey(pubkey, {target: init_leaf});

    /**
     * This is to test IF the tx COULD fail.
     * This is most likely happening due to an incompatible key being generated.
     */
    const test_redeemtx = Tx.create({
        vin  : [{
            txid: 'a99d1112bcb35845fd44e703ef2c611f0360dd2bb28927625dbc13eab58cd968',
            vout: 0,
            prevout: {
                value: 10000,
                scriptPubKey: [ 'OP_1', init_tapkey ]
            },
        }],
        vout : [{
            value: 8000,
            scriptPubKey: [ 'OP_1', init_tapkey ]
        }],
    });

    const test_sig = await Signer.taproot.sign(seckey.raw, test_redeemtx, 0, {extension: init_leaf});
    test_redeemtx.vin[0].witness = [ test_sig.hex, init_script, init_cblock ];
    const isValid = await Signer.taproot.verify(test_redeemtx, 0, { pubkey });

    if(!isValid)
    {
        alert('Generated keys could not be validated. Please reload the app.');
        return;
    }

    console.log('PUBKEY', pubkey);

    let inscriptions = [];
    let total_fee = 0;

    let feerate = await getMinFeeRate();
    sessionStorage["determined_feerate"] = sessionStorage["feerate"];

    if (sessionStorage["feerate"]) {

        feerate = Number(sessionStorage["feerate"]);
        sessionStorage["determined_feerate"] = sessionStorage["feerate"];
    }

    let total_size = 0;
    let vB_children = 0;

    for (let i = 0; i < files.length; i++) {

        const hex = files[i].hex;
        const data = hexToBytes(hex);
        const mimetype = ec.encode(files[i].mimetype);

        const script = [
            pubkey,
            'OP_CHECKSIG',
            'OP_0',
            'OP_IF',
            ec.encode('ord'),
            '01',
            mimetype,
            'OP_0',
            data,
            'OP_ENDIF'
        ];

        const script_backup = [
            '0x' + buf2hex(pubkey.buffer),
            'OP_CHECKSIG',
            'OP_0',
            'OP_IF',
            '0x' + buf2hex(ec.encode('ord')),
            '01',
            '0x' + buf2hex(mimetype),
            'OP_0',
            '0x' + buf2hex(data),
            'OP_ENDIF'
        ];

        const leaf = await Tap.tree.getLeaf(Script.encode(script));
        const [tapkey, cblock] = await Tap.getPubKey(pubkey, { target: leaf });

        let inscriptionAddress = Address.p2tr.encode(tapkey, encodedAddressPrefix);

        console.log('Inscription address: ', inscriptionAddress);
        console.log('Tapkey:', tapkey);

        let reverse_fee = 0;
        let fee = 0;
        let txsize = 0;

        if($('#turbo').checked && $('#cpfp').checked)
        {
            txsize = 140 + Math.floor(data.length / 4);

            let prefix = 0 + ( Math.round(data.length/1024) * 60);
            let prefix2 = 60 + ( Math.round(data.length/1024) * 60 );

            if(files[i].sha256 != '')
            {
                prefix = 60 + ( Math.round(data.length/1024) * 60 );
                prefix2 = 326 + ( Math.round(data.length/1024) * 60 );
            }

            fee = prefix + ( feerate * txsize );

            if($('#cursed').checked)
            {
                reverse_fee = prefix + 140 + ( feerate * 140 );
                fee += reverse_fee;
                reverse_fee = 0;
                reverse = padding;
            }

            total_fee += fee + reverse_fee + ( prefix2 * feerate ) + padding + reverse;

            total_size += txsize + 129;

            /*
            if($('#cursed').checked)
            {
                total_size += 2 * 326;
            }*/

            vB_children += txsize;
        }
        else if($('#cpfp').checked)
        {

            txsize = 140 + Math.floor(data.length / 4);

            let prefix = 0 + ( Math.round(data.length/1024) * 60);
            let prefix2 = 60 + ( Math.round(data.length/1024) * 60 );

            if(files[i].sha256 != '')
            {
                prefix = 60 + ( Math.round(data.length/1024) * 60 );
                prefix2 = 326 + ( Math.round(data.length/1024) * 60 );
            }

            fee = prefix + ( feerate * txsize );

            if($('#cursed').checked)
            {
                reverse_fee = prefix + 140 + ( feerate * 140 );
                fee += reverse_fee;
                reverse_fee = 0;
                reverse = padding;
            }

            total_fee += fee + reverse_fee + ( prefix2 * feerate ) + padding + reverse;

        }
        else
        {
            let prefix = 0;
            txsize = Math.floor(data.length / 4);

            if (txsize < 150) {

                txsize = 150;
            }

            if(files[i].sha256 != '') {

                prefix = 326;
            }

            fee = prefix + ( txsize * feerate );

            if($('#cursed').checked)
            {
                reverse_fee = prefix + 140 + ( feerate * 140 );
                fee += reverse_fee;
                reverse_fee = 0;
                reverse = padding;
            }

            total_fee += prefix + fee + reverse_fee + ( 129 * feerate ) + padding + reverse;
        }

        console.log("TXSIZE", txsize, fee);

        inscriptions.push(
            {
                leaf: leaf,
                tapkey: tapkey,
                cblock: cblock,
                inscriptionAddress: inscriptionAddress,
                txsize: txsize,
                fee: fee,
                script: script_backup,
                script_orig: script,
                reverse_fee : reverse_fee
            }
        );
    }

    let total_fees = 0;

    if($('#turbo').checked)
    {
        let vB_parent = ( 129 * inscriptions.length );
        let vB_sum = vB_parent + vB_children;
        let vB_effective_target = total_fee / total_size;
        let sat_parent = 129 * feerate;
        let effective_rate = ( vB_effective_target * vB_sum - sat_parent ) / ( vB_children );
        total_fees = Math.round(effective_rate * total_size);
        console.log("EFFECTIVE RATE", effective_rate, vB_parent, vB_children, vB_sum, vB_effective_target, sat_parent);
    }
    else
    {
        let prefix = 129;

        if($('#cpfp').checked)
        {
            prefix = 160;
        }

        if($('#cursed').checked)
        {
            prefix += 350;
        }

        total_fees = prefix + total_fee;
    }

    if(estimate)
    {
        $('#estimated-fees').innerHTML = ' = ' + total_fees + ' sats ($' + (Number(await satsToDollars(total_fees)).toFixed(2)) + ')';
        return files;
    }

    let fundingAddress = Address.p2tr.encode(init_tapkey, encodedAddressPrefix);
    console.log('Funding address: ', fundingAddress, 'based on', init_tapkey);

    let toAddress = $('.address').value;
    console.log('Address that will receive the inscription:', toAddress);

    $('#backup').style.display = "none";
    $('.submit').style.display = "none";
    $('.estimate').style.display = "none";
    $('#estimated-fees').style.display = "none";
    $('.startover').style.display = "inline-block";

    let tip = parseInt($('#tip').value);

    if(!isNaN(tip) && tip >= 500)
    {
        total_fees += tip;
    }

    let sats_price = await satsToDollars(total_fees);
    sats_price = Math.floor(sats_price * 100) / 100;

    let btc_price = formatNumberString(""+total_fees, 8);

    let html = `<p>Please send at least <strong>${total_fees} sats</strong> / ${btc_price} BTC ($${sats_price}) to the address below (click to copy).</p><div style="color:red;">Once you sent the amount, do NOT close this window and wait for every step to complete!</div><p><input readonly="readonly" onclick="copyFundingAddress()" id="fundingAddress" type="text" value="${fundingAddress}" style="width: 80%;" /> <span id="fundingAddressCopied"></span>`;
    html += '<div>' +
        '            <label style="display: inline-block;" for="inscriptions-manually">Trigger Inscriptions Manually</label>' +
        '            <input style="display: inline-block; height: 0.9rem; width:unset" id="inscriptions-manually" type="checkbox" onclick="inscriptionsManually(this)" value="1"/>' +
        '        </div></p>';
    $('.display').innerHTML = html;

    let qr_value = "bitcoin:" + fundingAddress + "?amount=" + satsToBitcoin(total_fees);
    console.log("qr:", qr_value);

    let overhead = total_fees - total_fee - (padding * inscriptions.length) - tip;

    if(isNaN(overhead) || overhead < 0)
    {
        overhead = 0;
    }

    if(isNaN(tip))
    {
        tip = 0;
    }

    $('.display').append(createQR(qr_value));
    $('.display').innerHTML += `<p class="checking_mempool">Checking the mempool<span class="dots">.</span></p>`;
    $('.display').innerHTML += '<p>' + (padding * inscriptions.length) + ` sats will go to the address.</p><p>${total_fee} sats will go to miners as a mining fee.</p><p>${overhead} sats overhead will be used as boost.</p><p>${tip} sats for developer tipping.</p>`;
    $('.display').style.display = "block";
    $('#setup').style.display = "none";

    await insDateStore(privkey, new Date().toString());

    let transaction = [];
    transaction.push({txsize : 60, vout : 0, script: init_script_backup, output : {value: total_fees, scriptPubKey: [ 'OP_1', init_tapkey ]}});
    transaction.push({txsize : 60, vout : 1, script: init_script_backup, output : {value: total_fees, scriptPubKey: [ 'OP_1', init_tapkey ]}});
    await insStore(privkey, JSON.stringify(transaction));

    let include_mempool = $('#cpfp').checked;

    await loopTilAddressReceivesMoney(fundingAddress, true);
    await waitSomeSeconds(2);

    $('.display').innerHTML = '<div id="funds-msg">Funds are on the way. Please wait'+(!$('#cpfp').checked ? ' for the funding transaction to confirm (CPFP disabled)' : '')+'...<div style="color: red;">DO NOT CLOSE THIS BROWSER WINDOW!</div></div>';

    await loopTilAddressReceivesMoney(fundingAddress, include_mempool);
    await waitSomeSeconds(2);
    let txinfo = await addressReceivedMoneyInThisTx(fundingAddress);
    let rbf_txinfo = txinfo;

    let txid = txinfo[0];
    let vout = txinfo[1];
    let amt = txinfo[2];

    console.log("yay! txid:", txid, "vout:", vout, "amount:", amt);

    $('.display').innerHTML = '<div id="funds-msg">Inscriptions about to begin. Please wait'+(!$('#cpfp').checked ? ' for the seed transaction to confirm (CPFP disabled)' : '')+'...<div style="color: red;">DO NOT CLOSE THIS BROWSER WINDOW!</div></div>';

    let outputs_info = [];
    let outputs = [];

    transaction = [];
    transaction.push({txsize : 60, vout : vout, script: init_script_backup, output : {value: amt, scriptPubKey: [ 'OP_1', init_tapkey ]}});

    for (let i = 0; i < inscriptions.length; i++) {

        outputs.push(
            {
                value: padding + inscriptions[i].fee,
                scriptPubKey: [ 'OP_1', inscriptions[i].tapkey ]
            }
        );

        let is_cursed = false;

        if($('#cursed').checked)
        {
            is_cursed = true;
        }

        let store = {next_cursed: vout + inscriptions.length, txsize : inscriptions[i].txsize, vout : i, script: inscriptions[i].script, output : outputs[outputs.length - 1]};
        transaction.push(store);
        outputs_info.push(store);
    }

    if($('#cursed').checked)
    {
        for (let i = 0; i < inscriptions.length; i++)
        {
            outputs.push(
                {
                    value: reverse + inscriptions[i].reverse_fee,
                    scriptPubKey: ['OP_1', init_tapkey]
                }
            );

            let store = {cursed: true, txsize: 326, vout: i + inscriptions.length, script: init_script_backup, output: outputs[outputs.length - 1]};
            transaction.push(store);
            outputs_info.push(store);
        }
    }

    if(!isNaN(tip) && tip >= 500)
    {

        if(active_plugin !== null && typeof active_plugin.instance.customOutputs != 'undefined')
        {
            let custom_outputs = await active_plugin.instance.customOutputs(tip);

            for(let i = 0; i < custom_outputs.length; i++)
            {
                outputs.push(custom_outputs[i]);

                let store = {txsize : 148, vout : null, script: null, output : outputs[outputs.length - 1]};
                outputs_info.push(store);
            }
        }
        else
        {
            outputs.push(
                {
                    value: tip,
                    scriptPubKey: [ 'OP_1', Address.p2tr.decode(tippingAddress, encodedAddressPrefix).hex ]
                }
            );

            let store = {txsize : 148, vout : null, script: null, output : outputs[outputs.length - 1]};
            outputs_info.push(store);
        }
    }

    await insStore(privkey, JSON.stringify(transaction));

    const init_redeemtx = Tx.create({
        vin  : [{
            txid: txid,
            vout: vout,
            prevout: {
                value: amt,
                scriptPubKey: [ 'OP_1', init_tapkey ]
            },
            sequence: 0xfffffffd
        }],
        vout : outputs
    });

    const init_sig = await Signer.taproot.sign(seckey.raw, init_redeemtx, 0, {extension: init_leaf});
    init_redeemtx.vin[0].witness = [ init_sig.hex, init_script, init_cblock ];

    console.dir(init_redeemtx, {depth: null});
    console.log('YOUR SECKEY', seckey);

    let rawtx = Tx.encode(init_redeemtx).hex;
    let _txid = await pushBTCpmt(rawtx);

    console.log('Init TX id', _txid);
    console.log('Init TX raw', rawtx);
    console.log('Init TX', init_redeemtx);

    let _toAddress;
    let _script;

    if(toAddress.startsWith('tb1q') || toAddress.startsWith('bc1q'))
    {
        _toAddress = Address.p2wpkh.decode(toAddress, encodedAddressPrefix).hex;
        _script = [ 'OP_0', _toAddress ];
        console.log('using p2wpkh', _script);
    }
    else if(toAddress.startsWith('1') || toAddress.startsWith('m') || toAddress.startsWith('n'))
    {
        _toAddress = Address.p2pkh.decode(toAddress, encodedAddressPrefix).hex;
        _script = Address.p2pkh.scriptPubKey(_toAddress);
        console.log('using p2pkh', _script);
    }
    else if(toAddress.startsWith('3') || toAddress.startsWith('2'))
    {
        _toAddress = Address.p2sh.decode(toAddress, encodedAddressPrefix).hex;
        _script = Address.p2sh.scriptPubKey(_toAddress);
        console.log('using p2sh', _script);
    }
    else
    {
        _toAddress = Address.p2tr.decode(toAddress, encodedAddressPrefix).hex;
        _script = [ 'OP_1', _toAddress ];
        console.log('using p2tr', _script);
    }

    // CANCEL INSCRIPTIONS SETUP

    async function cancelInscriptions(){

        let confirmed = confirm('Are you sure you want to cancel? The funds will be sent to the original inscription address you set up. To use an alternative address, please use the receiver field.');

        if(!confirmed)
        {
            return;
        }

        let _cancelscript = _script;

        if($('#cancel_address').value.trim() != '' && isValidTaprootAddress($('#cancel_address').value))
        {
            let cancelAddress = $('#cancel_address').value.trim();
            let _cancelAddress;

            if(cancelAddress.startsWith('tb1q') || cancelAddress.startsWith('bc1q'))
            {
                _cancelAddress = Address.p2wpkh.decode(cancelAddress, encodedAddressPrefix).hex;
                _cancelscript = [ 'OP_0', _cancelAddress ];
                console.log('using p2wpkh', _cancelscript);
            }
            else if(cancelAddress.startsWith('1') || cancelAddress.startsWith('m') || cancelAddress.startsWith('n'))
            {
                _cancelAddress = Address.p2pkh.decode(cancelAddress, encodedAddressPrefix).hex;
                _cancelscript = Address.p2pkh.scriptPubKey(_cancelAddress);
                console.log('using p2pkh', _cancelscript);
            }
            else if(cancelAddress.startsWith('3') || cancelAddress.startsWith('2'))
            {
                _cancelAddress = Address.p2sh.decode(cancelAddress, encodedAddressPrefix).hex;
                _cancelscript = Address.p2sh.scriptPubKey(_cancelAddress);
                console.log('using p2sh', _cancelscript);
            }
            else
            {
                _cancelAddress = Address.p2tr.decode(cancelAddress, encodedAddressPrefix).hex;
                _cancelscript = [ 'OP_1', _cancelAddress ];
                console.log('using p2tr', _cancelscript);
            }
        }
        else if($('#cancel_address').value.trim() != '')
        {
            alert('Invalid receiver!');
            return;
        }

        const rbf_redeemtx = Tx.create({
            vin  : [{
                txid: rbf_txinfo[0],
                vout: rbf_txinfo[1],
                prevout: {
                    value: rbf_txinfo[2],
                    scriptPubKey: [ 'OP_1', init_tapkey ]
                },
                sequence: 0xfffffffd
            }],
            vout : [{
                value: rbf_txinfo[2] - parseInt($('#cancel_extra').value),
                scriptPubKey: _cancelscript
            }]
        });

        console.log('RBF TX', rbf_redeemtx);

        const init_sig = await Signer.taproot.sign(seckey.raw, rbf_redeemtx, 0, {extension: init_leaf});
        rbf_redeemtx.vin[0].witness = [ init_sig.hex, init_script, init_cblock ];

        let rbf_rawtx = Tx.encode(rbf_redeemtx).hex;

        console.log('RBF RAW TX', rbf_rawtx);

        let rbf_txid = await pushBTCpmt(rbf_rawtx);

        console.log('RBF TXID', rbf_txid);

        return rbf_txid;
    }

    if(_txid.includes('descendant'))
    {
        alert('You have too many unfinished transactions. Please reload the app and recover your funds using the backup. Then continue after your previous transactions finished.');
        return;
    }

    let processed = 0;

    async function inscribe(inscription, vout) {

        // we are running into an issue with 25 child transactions for unconfirmed parents.
        // so once the limit is reached, we wait for the parent tx to confirm.

        await loopTilAddressReceivesMoney(inscription.inscriptionAddress, include_mempool);
        await waitSomeSeconds(2);
        let txinfo2 = await addressReceivedMoneyInThisTx(inscription.inscriptionAddress);

        document.getElementById('funds-msg').style.display = 'none';

        let txid2 = txinfo2[0];
        let amt2 = txinfo2[2];

        let redeemtx;

        if($('#cursed').checked)
        {
            redeemtx = Tx.create({
                vin  : [
                    {
                        txid: txid2,
                        vout: vout + inscriptions.length,
                        prevout: {
                            value: reverse + inscription.reverse_fee,
                            scriptPubKey: [ 'OP_1', init_tapkey ]
                        },
                    },
                    {
                        txid: txid2,
                        vout: vout,
                        prevout: {
                            value: padding + inscription.fee,
                            scriptPubKey: [ 'OP_1', inscription.tapkey ]
                        },
                    }],
                vout : [{
                    value: padding + reverse,
                    scriptPubKey: _script
                }],
            });

            const reverse_sig = await Signer.taproot.sign(seckey.raw, redeemtx, 0, {extension: init_leaf});
            redeemtx.vin[0].witness = [ reverse_sig.hex, init_script, init_cblock ];

            const sig = await Signer.taproot.sign(seckey.raw, redeemtx, 1, {extension: inscription.leaf});
            redeemtx.vin[1].witness = [ sig.hex, inscription.script_orig, inscription.cblock ];
        }
        else
        {
            redeemtx = Tx.create({
                vin  : [{
                    txid: txid2,
                    vout: vout,
                    prevout: {
                        value: amt2,
                        scriptPubKey: [ 'OP_1', inscription.tapkey ]
                    },
                }],
                vout : [{
                    value: amt2 - inscription.fee,
                    scriptPubKey: _script
                }],
            });

            const sig = await Signer.taproot.sign(seckey.raw, redeemtx, 0, {extension: inscription.leaf});
            redeemtx.vin[0].witness = [ sig.hex, inscription.script_orig, inscription.cblock ];
        }

        console.dir(redeemtx, {depth: null});

        let rawtx2 = Tx.encode(redeemtx).hex;
        let _txid2;

        // since we don't know any mempool space api rate limits, we will be careful with spamming
        await isPushing();
        pushing = true;
        _txid2 = await pushBTCpmt( rawtx2 );
        await sleep(1000);
        pushing = false;

        if(_txid2.includes('descendant'))
        {
            include_mempool = false;
            inscribe(inscription, vout);
            $('#descendants-warning').style.display = 'block';
            return;
        }

        processed += 1;

        if(processed == inscriptions.length)
        {
            include_mempool = false;
        }

        try {

            JSON.parse(_txid2);

            let html = `<p style="padding: 5px; background-color: white; color: black;">Error: ${_txid2}</p>`;
            html += '<hr/>';
            $('.display').innerHTML += html;

        } catch (e) {

            let explorer = 'https://ordinals.com';

            if($('#cursed').checked)
            {
                explorer = 'http://176.9.24.92:3333';
            }

            let html = `<p style="padding: 5px; background-color: white; color: black;">Inscription #${vout} transaction:</p><p style="word-wrap: break-word;"><a href="https://mempool.space/${mempoolNetwork}tx/${_txid2}" target="_blank">https://mempool.space/${mempoolNetwork}tx/${_txid2}</a></p>`;
            html += `<p style="padding: 5px; background-color: white; color: black;">Ordinals explorer (after tx confirmation):</p><p style="word-wrap: break-word;"><a href="${explorer}/inscription/${_txid2}i0" target="_blank">${explorer}/inscription/${_txid2}i0</a></p>`;
            html += '<hr/>';
            $('.display').innerHTML += html;
        }
    }

    if(inscriptions_manually)
    {

        $('.display').style.display = 'none';
        $('#manual-inscriptions').style.display = 'block';
        $('#trigger-inscriptions').onclick = async function()
        {

            $('.display').style.display = 'block';
            $('#manual-inscriptions').style.display = 'none';

            for (let i = 0; i < inscriptions.length; i++) {

                inscribe(inscriptions[i], i);
            }
        }
    }
    else
    {
        for (let i = 0; i < inscriptions.length; i++) {

            inscribe(inscriptions[i], i);
        }
    }

    if($('#cpfp').checked)
    {

        if(!inscriptions_manually)
        {

            while(include_mempool)
            {
                await sleep(100);
            }
        }

        // CANCEL TX SETUP

        $('#txlink').innerHTML = '<a href="'+"https://mempool.space/" + mempoolNetwork + "tx/"+rbf_txinfo[0]+'" target="_blank">Mempool</a>';
        $('#cancel_value').innerHTML = rbf_txinfo[2];

        // creating suggested buyout, depending on the inscription state

        if(processed != 0)
        {
            $('#cancel_extra').value = Math.round(rbf_txinfo[2] * 0.7);
            $('#cancel_result').innerHTML = rbf_txinfo[2] - Math.round(rbf_txinfo[2] * 0.7);
        }
        else
        {
            $('#cancel_extra').value = Math.round(rbf_txinfo[2] * 0.3);
            $('#cancel_result').innerHTML = rbf_txinfo[2] - Math.round(rbf_txinfo[2] * 0.3);
        }

        $('#cancel_extra').onchange = async function()
        {
            $('#cancel_result').innerHTML = rbf_txinfo[2] - parseInt($('#cancel_extra').value);
        }

        $('#cancelTx').onclick = async function()
        {
            if((""+$('#cancel_extra').value).includes('.') || (""+$('#cancel_extra').value).includes(','))
            {
                alert('Please enter an offer in sats.');
                return;
            }

            if(isNaN(parseInt($('#cancel_extra').value)))
            {
                alert('Invalid sats amount.');
                return;
            }

            let result = await cancelInscriptions();

            if(result)
            {

                $('#cancelMsg').innerHTML += '<div style="font-size: 13px;">'+result+'</div><hr/>';
            }
        }

        $('#transaction-actions').style.display = "block";
    }
}

async function initDatabase(){

    db = await idb.openDB("Inscriptions", 1, {
        upgrade(db, oldVersion, newVersion, transaction, event) {
            let store = db.createObjectStore("InscriptionsLog", {keyPath: "PrivKey"});
            let index = store.createIndex("PrivKey", "data.inscription", { unique: false });
            console.log(index);
            store = db.createObjectStore("InscriptionDates", {keyPath: "PrivKey"});
            index = store.createIndex("PrivKey", "data.date", { unique: false });
            console.log(index);
        }
    });
}

async function insDateStore(key, val){
    let tx = db.transaction("InscriptionDates", "readwrite");
    let store = tx.objectStore("InscriptionDates");
    await store.put({PrivKey: key, data : { date : val} });
    await tx.done;
}

async function insDateGet(key){
    let tx = db.transaction("InscriptionDates", "readwrite");
    let store = tx.objectStore("InscriptionDates");
    let date = await store.get(key);
    await tx.done;
    return date.data.date;
}

async function insDateDelete(key){
    let tx = db.transaction("InscriptionDates", "readwrite");
    let store = tx.objectStore("InscriptionDates");
    await store.delete(key);
    await tx.done;
}

async function insGet(key){
    let tx = db.transaction("InscriptionsLog", "readwrite");
    let store = tx.objectStore("InscriptionsLog");
    let inscription = await store.get(key);
    await tx.done;
    return inscription.data.inscription;
}

async function insStore(key, val){
    let tx = db.transaction("InscriptionsLog", "readwrite");
    let store = tx.objectStore("InscriptionsLog");
    await store.put({PrivKey: key, data : { inscription : val} });
    await tx.done;
}

async function insGet(key){
    let tx = db.transaction("InscriptionsLog", "readwrite");
    let store = tx.objectStore("InscriptionsLog");
    let inscription = await store.get(key);
    await tx.done;
    return inscription.data.inscription;
}

async function insDelete(key){
    let tx = db.transaction("InscriptionsLog", "readwrite");
    let store = tx.objectStore("InscriptionsLog");
    await store.delete(key);
    await tx.done;
}

async function insGetAllKeys(){
    let tx = db.transaction("InscriptionsLog", "readwrite");
    let store = tx.objectStore("InscriptionsLog");
    let index = store.index("PrivKey");
    let allKeys = await index.getAllKeys();
    await tx.done;
    return allKeys;
}

async function insQuota(){
    const quota = await navigator.storage.estimate();
    return quota;
}

async function recover(index, utxo_vout, to, privkey) {

    if(!isValidTaprootAddress(to))
    {
        $('#recovery-item-'+privkey+'-'+utxo_vout).innerHTML += '<div style="font-size: 14px;">Invalid taproot address. Please add the recovery recipient in the "Receiving address" at the very top.</a>';
        console.log('Invalid to address.');
        return;
    }

    let feerate = await getMinFeeRate();

    if (sessionStorage["feerate"]) {

        feerate = Number(sessionStorage["feerate"]);
    }

    const KeyPair = cryptoUtils.KeyPair;
    let tx = JSON.parse(await insGet(privkey));
    let seckey = new KeyPair(privkey);
    let pubkey = seckey.pub.rawX;
    let inputs = [];
    let base_fee = 148 + ( feerate * tx[index].txsize );
    let scripts = [];

    if(!Array.isArray(tx[index].output.scriptPubKey))
    {

        if(tx[index].output.scriptPubKey.startsWith('5120'))
        {
            tx[index].output.scriptPubKey = tx[index].output.scriptPubKey.slice(4);
        }

        tx[index].output.scriptPubKey = ['OP_1', tx[index].output.scriptPubKey];
    }

    let cursed_tx = null;
    let cursed = false;
    let init_tapkey = null;

    for(let curs in tx)
    {
        if(typeof tx[curs].cursed != 'undefined' && tx[curs].cursed)
        {
            cursed = true;
            init_tapkey = tx[curs].output.scriptPubKey[1];
            cursed_tx = tx[curs];
            break;
        }
    }

    let plainTapKey = tx[index].output.scriptPubKey[1];
    let response = await getData('https://mempool.space/'+mempoolNetwork+'api/address/' + Address.p2tr.encode(plainTapKey, encodedAddressPrefix) + '/utxo');
    let utxos = JSON.parse(response);
    let utxo = null;

    for (let i = 0; i < utxos.length; i++)
    {
        if(utxos[i].vout == utxo_vout)
        {
            utxo = utxos[i];
            break;
        }
    }

    let cursed_utxo = null;

    if(cursed)
    {
        let cursed_response = await getData('https://mempool.space/'+mempoolNetwork+'api/address/' + Address.p2tr.encode(init_tapkey, encodedAddressPrefix) + '/utxo');
        let cursed_utxos = JSON.parse(cursed_response);

        for (let i = 0; i < cursed_utxos.length; i++)
        {
            cursed_utxo = cursed_utxos[i];
            break;
        }
    }

    if(utxo === null)
    {
        $('#recovery-item-'+privkey+'-'+utxo_vout).innerHTML += '<div style="font-size: 14px;">Utxo not found</a>';
        console.log('Utxo not found');
        return;
    }

    console.log(Address.p2tr.encode(plainTapKey, encodedAddressPrefix));
    console.log(utxo);

    let txid = utxo.txid;

    console.log(tx[index]);

    for(let j = 0; j < tx[index].script.length; j++){

        if(tx[index].script[j].startsWith('0x'))
        {
            tx[index].script[j] = hexToBytes(tx[index].script[j].replace('0x',''));
        }
    }

    if(cursed)
    {
        for(let j = 0; j < cursed_tx.script.length; j++){

            if(cursed_tx.script[j].startsWith('0x'))
            {
                cursed_tx.script[j] = hexToBytes(cursed_tx.script[j].replace('0x',''));
            }
        }
    }

    if(cursed)
    {
        let cursed_script = cursed_tx.script;
        delete cursed_tx.script;

        inputs.push({
            txid: cursed_utxo.txid,
            vout: cursed_utxo.vout,
            prevout: cursed_tx.output
        });

        scripts.push(cursed_script);
    }

    let script = tx[index].script;
    delete tx[index].script;
    tx[index].output.value = utxo.value;

    inputs.push({
        txid: txid,
        vout: utxo_vout,
        prevout: tx[index].output
    });

    scripts.push(script);

    console.log('RECOVER:INPUTS', inputs);

    if(utxo.value - base_fee <= 0){

        $('#recovery-item-'+privkey+'-'+utxo_vout).innerHTML += '<div style="font-size: 14px;">Nothing found to recover: ' + (utxo.value - base_fee) + ' sats</div>';

        return;
    }

    let cursed_value = 0;

    if(cursed)
    {
        cursed_value = cursed_tx.output.value - 140 - ( 140 * feerate );
    }

    let output_value = cursed_value + utxo.value - base_fee;

    if(output_value - 546 > 546)
    {
        output_value = output_value - 546;
    }

    let _toAddress;
    let _script;

    if(to.startsWith('tb1q') || to.startsWith('bc1q'))
    {
        _toAddress = Address.p2wpkh.decode(to, encodedAddressPrefix).hex;
        _script = [ 'OP_0', _toAddress ];
        console.log('using p2wpkh', _script);
    }
    else if(to.startsWith('1') || to.startsWith('m') || to.startsWith('n'))
    {
        _toAddress = Address.p2pkh.decode(to, encodedAddressPrefix).hex;
        _script = Address.p2pkh.scriptPubKey(_toAddress);
        console.log('using p2pkh', _script);
    }
    else if(to.startsWith('3') || to.startsWith('2'))
    {
        _toAddress = Address.p2sh.decode(to, encodedAddressPrefix).hex;
        _script = Address.p2sh.scriptPubKey(_toAddress);
        console.log('using p2sh', _script);
    }
    else
    {
        _toAddress = Address.p2tr.decode(to, encodedAddressPrefix).hex;
        _script = [ 'OP_1', _toAddress ];
        console.log('using p2tr', _script);
    }

    const redeemtx = Tx.create({
        vin  : inputs,
        vout : [{
            value: output_value,
            scriptPubKey: _script
        }],
    });

    console.log(scripts);

    if(!cursed) {

        for (let i = 0; i < inputs.length; i++) {

            let leaf = await Tap.tree.getLeaf(Script.encode(scripts[i]));
            let [tapkey, cblock] = await Tap.getPubKey(pubkey, {target: leaf});
            const sig = await Signer.taproot.sign(seckey.raw, redeemtx, 0, {extension: leaf});
            redeemtx.vin[0].witness = [sig.hex, scripts[i], cblock];
        }
    }
    else
    {

        let c_leaf = await Tap.tree.getLeaf(Script.encode(scripts[0]));
        let [c_tapkey, c_cblock] = await Tap.getPubKey(pubkey, {target: c_leaf});
        const c_sig = await Signer.taproot.sign(seckey.raw, redeemtx, 0, {extension: c_leaf});
        redeemtx.vin[0].witness = [c_sig.hex, scripts[0], c_cblock];

        let leaf = await Tap.tree.getLeaf(Script.encode(scripts[1]));
        let [tapkey, cblock] = await Tap.getPubKey(pubkey, {target: leaf});
        const sig = await Signer.taproot.sign(seckey.raw, redeemtx, 1, {extension: leaf});
        redeemtx.vin[1].witness = [sig.hex, scripts[1], cblock];
    }

    console.log('RECOVER:REDEEMTEX', redeemtx);

    let rawtx = Tx.encode(redeemtx).hex;
    let _txid = await pushBTCpmt(rawtx);

    if(_txid.includes('descendant'))
    {
        _txid = 'Please wait for the other transactions to finish and then try again.';
    }

    console.log('RECOVER:PUSHRES', _txid);

    $('#recovery-item-'+privkey+'-'+utxo_vout).innerHTML += '<div style="font-size: 14px;">Result: ' + _txid+'</div>';
}

function inscriptionsManually(manually)
{
    if(manually.checked)
    {
        inscriptions_manually = true;
    }
    else
    {
        inscriptions_manually = false;
    }
}

function addMoreText(){

    let cloned = $$('.text_area')[0].cloneNode(true);
    cloned.value = '';
    document.getElementById("form_container").appendChild(cloned);
    cloned.focus();
}

function arrayBufferToBuffer(ab) {
    var buffer = new buf.Buffer(ab.byteLength)
    var view = new Uint8Array(ab)
    for (var i = 0; i < buffer.length; ++i) {
        buffer[i] = view[i]
    }
    return buffer
}

function hexString(buffer) {
    const byteArray = new Uint8Array(buffer)
    const hexCodes = [...byteArray].map(value => {
        return value.toString(16).padStart(2, '0')
    })

    return '0x' + hexCodes.join('')
}

async function fileToArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader()
        const readFile = function (event) {
            const buffer = reader.result
            resolve(buffer)
        }

        reader.addEventListener('load', readFile)
        reader.readAsArrayBuffer(file)
    })
}

async function bufferToSha256(buffer) {
    return window.crypto.subtle.digest('SHA-256', buffer)
}

async function fileToSha256Hex(file) {
    const buffer = await fileToArrayBuffer(file)
    const hash = await bufferToSha256(arrayBufferToBuffer(buffer))
    return hexString(hash)
}

function copyFundingAddress() {
    let copyText = document.getElementById("fundingAddress");
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value);
    document.getElementById("fundingAddressCopied").innerHTML = ' Copied!';
    setTimeout(function () {

        document.getElementById("fundingAddressCopied").innerHTML = '';

    }, 5000);
}

async function isPushing() {
    while (pushing) {
        await sleep(10);
    }
}

function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMaxFeeRate() {
    let fees = await getData("https://mempool.space/" + mempoolNetwork + "api/v1/fees/recommended");
    fees = JSON.parse(fees);
    // if ( !( "minimumFee" in fees ) ) return "error -- site down";
    // var minfee = fees[ "minimumFee" ];
    if (!("fastestFee" in fees)) return "error -- site down";
    let maxfee = fees["fastestFee"];
    return maxfee;
}

async function getMinFeeRate() {
    let fees = await getData("https://mempool.space/" + mempoolNetwork + "api/v1/fees/recommended");
    fees = JSON.parse(fees);
    if (!("minimumFee" in fees)) return "error -- site down";
    let minfee = fees["minimumFee"];
    // if ( !( "fastestFee" in fees ) ) return "error -- site down";
    // var maxfee = fees[ "fastestFee" ];
    return minfee;
}

function isValidTaprootAddress(toAddress) {

    if(toAddress.startsWith('tb1q') || toAddress.startsWith('bc1q'))
    {
        try {
            Address.p2wpkh.decode(toAddress, encodedAddressPrefix).hex;
            return true;
        } catch (e) {
            console.log(e);
        }

    }
    else if(toAddress.startsWith('1') || toAddress.startsWith('m') || toAddress.startsWith('n'))
    {
        try {
            Address.p2pkh.decode(toAddress, encodedAddressPrefix).hex;
            return true;
        } catch (e) {
            console.log(e);
        }
    }
    else if(toAddress.startsWith('3') || toAddress.startsWith('2'))
    {
        try {
            Address.p2sh.decode(toAddress, encodedAddressPrefix).hex;
            return true;
        } catch (e) {
            console.log(e);
        }
    }
    else
    {
        try {
            Address.p2tr.decode(toAddress).hex;
            return true;
        } catch (e) {
            console.log(e);
        }
    }

    return;
}

function isValidJson(content) {
    if (!content) return;
    try {
        var json = JSON.parse(content);
    } catch (e) {
        return;
    }
    return true;
}

async function getAllFeeRates() {
    let fees = await getData("https://mempool.space/" + mempoolNetwork + "api/v1/fees/recommended");
    fees = JSON.parse(fees);
    return fees;
}

function getData(url) {
    return new Promise(async function (resolve, reject) {
        function inner_get(url) {
            let xhttp = new XMLHttpRequest();
            xhttp.open("GET", url, true);
            xhttp.send();
            return xhttp;
        }

        let data = inner_get(url);
        data.onerror = function (e) {
            resolve("error");
        }

        async function isResponseReady() {
            return new Promise(function (resolve2, reject) {
                if (!data.responseText || data.readyState != 4) {
                    setTimeout(async function () {
                        let msg = await isResponseReady();
                        resolve2(msg);
                    }, 1);
                } else {
                    resolve2(data.responseText);
                }
            });
        }

        let returnable = await isResponseReady();
        resolve(returnable);
    });
}


async function pushBTCpmt(rawtx) {

    let txid;

    try
    {
        txid = await postData("https://mempool.space/" + mempoolNetwork + "api/tx", rawtx);

        if( ( txid.toLowerCase().includes('error') || txid.toLowerCase().includes('too many requests') || txid.toLowerCase().includes('bad request') ) && !txid.includes('descendant'))
        {
            if(encodedAddressPrefix == 'main')
            {
                console.log('USING BLOCKSTREAM FOR PUSHING INSTEAD');
                txid = await postData("https://blockstream.info/api/tx", rawtx);
            }
        }
    }
    catch(e)
    {
        if(encodedAddressPrefix == 'main')
        {
            console.log('USING BLOCKSTREAM FOR PUSHING INSTEAD');
            txid = await postData("https://blockstream.info/api/tx", rawtx);
        }
    }

    return txid;
}


/*
async function pushBTCpmt(rawtx) {

    let txid = null;

    try
    {

        if(encodedAddressPrefix == 'main') {

            txid = await postData("https://mem-api.ordapi.xyz/tx", rawtx);
            console.log('USING ORDAPI FOR PUSHING', txid);
        }

        if( txid === null || ( (txid.toLowerCase().includes('error') || txid.toLowerCase().includes('too many requests') || txid.toLowerCase().includes('bad request')) && !txid.includes('descendant') ) ) {

            txid = await postData("https://mempool.space/" + mempoolNetwork + "api/tx", rawtx);

            if ((txid.toLowerCase().includes('error') || txid.toLowerCase().includes('too many requests') || txid.toLowerCase().includes('bad request')) && !txid.includes('descendant')) {

                if (encodedAddressPrefix == 'main') {
                    console.log('USING BLOCKSTREAM FOR PUSHING INSTEAD');
                    txid = await postData("https://blockstream.info/api/tx", rawtx);
                }
            }
        }
    }
    catch(e)
    {
        if(encodedAddressPrefix == 'main')
        {
            console.log('USING BLOCKSTREAM FOR PUSHING INSTEAD');
            txid = await postData("https://blockstream.info/api/tx", rawtx);
        }
    }

    return txid;
}*/

function waitSomeSeconds(number) {
    let num = number.toString() + "000";
    num = Number(num);
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve("");
        }, num);
    });
}

async function postData(url, json, content_type = "", apikey = "") {
    let rtext = "";

    function inner_post(url, json, content_type = "", apikey = "") {
        let xhttp = new XMLHttpRequest();
        xhttp.open("POST", url, true);
        if (content_type) {
            xhttp.setRequestHeader(`Content-Type`, content_type);
        }
        if (apikey) {
            xhttp.setRequestHeader(`X-Api-Key`, apikey);
        }
        xhttp.send(json);
        return xhttp;
    }

    let data = inner_post(url, json, content_type, apikey);
    data.onerror = function (e) {
        rtext = "error";
    }

    async function isResponseReady() {
        return new Promise(function (resolve, reject) {
            if (rtext == "error") {
                resolve(rtext);
            }
            if (!data.responseText || data.readyState != 4) {
                setTimeout(async function () {
                    let msg = await isResponseReady();
                    resolve(msg);
                }, 50);
            } else {
                resolve(data.responseText);
            }
        });
    }

    let returnable = await isResponseReady();
    return returnable;
}

async function loopTilAddressReceivesMoney(address, includeMempool) {
    let itReceivedMoney = false;

    async function isDataSetYet(data_i_seek) {
        return new Promise(function (resolve, reject) {
            if (!data_i_seek) {
                setTimeout(async function () {
                    console.log("waiting for address to receive money...");
                    try {
                        itReceivedMoney = await addressOnceHadMoney(address, includeMempool);
                    }catch(e){ }
                    let msg = await isDataSetYet(itReceivedMoney);
                    resolve(msg);
                }, 2000);
            } else {
                resolve(data_i_seek);
            }
        });
    }

    async function getTimeoutData() {
        let data_i_seek = await isDataSetYet(itReceivedMoney);
        return data_i_seek;
    }

    let returnable = await getTimeoutData();
    return returnable;
}

async function addressReceivedMoneyInThisTx(address) {
    let txid;
    let vout;
    let amt;
    let nonjson;

    try
    {
        nonjson = await getData("https://mempool.space/" + mempoolNetwork + "api/address/" + address + "/txs");

        if(nonjson.toLowerCase().includes('error') || nonjson.toLowerCase().includes('too many requests') || nonjson.toLowerCase().includes('bad request'))
        {
            if(encodedAddressPrefix == 'main')
            {
                nonjson = await getData("https://blockstream.info/api/address/" + address + "/txs");
            }
        }
    }
    catch(e)
    {
        if(encodedAddressPrefix == 'main')
        {
            nonjson = await getData("https://blockstream.info/api/address/" + address + "/txs");
        }
    }

    let json = JSON.parse(nonjson);
    json.forEach(function (tx) {
        tx["vout"].forEach(function (output, index) {
            if (output["scriptpubkey_address"] == address) {
                txid = tx["txid"];
                vout = index;
                amt = output["value"];
            }
        });
    });
    return [txid, vout, amt];
}

async function addressOnceHadMoney(address, includeMempool) {
    let url;
    let nonjson;

    try
    {
        url = "https://mempool.space/" + mempoolNetwork + "api/address/" + address;
        nonjson = await getData(url);

        if(nonjson.toLowerCase().includes('error') || nonjson.toLowerCase().includes('too many requests') || nonjson.toLowerCase().includes('bad request'))
        {
            if(encodedAddressPrefix == 'main')
            {
                url = "https://blockstream.info/api/address/" + address;
                nonjson = await getData(url);
            }
        }
    }
    catch(e)
    {
        if(encodedAddressPrefix == 'main')
        {
            url = "https://blockstream.info/api/address/" + address;
            nonjson = await getData(url);
        }
    }

    if (!isValidJson(nonjson)) return false;
    let json = JSON.parse(nonjson);
    if (json["chain_stats"]["tx_count"] > 0 || (includeMempool && json["mempool_stats"]["tx_count"] > 0)) {
        return true;
    }
    return false;
}

/*
async function addressOnceHadMoney(address, includeMempool) {
    let url;
    let nonjson = null;

    try
    {
        if(encodedAddressPrefix == 'main') {

            url = "https://mem-api.ordapi.xyz/address/" + address;
            nonjson = await getData(url);
        }

        if(nonjson === null || nonjson.toLowerCase().includes('not found') || nonjson.toLowerCase().includes('error') || nonjson.toLowerCase().includes('too many requests') || nonjson.toLowerCase().includes('bad request') ) {

            url = "https://mempool.space/" + mempoolNetwork + "api/address/" + address;
            nonjson = await getData(url);

            if (nonjson.toLowerCase().includes('error') || nonjson.toLowerCase().includes('too many requests') || nonjson.toLowerCase().includes('bad request')) {

                if (encodedAddressPrefix == 'main') {

                    url = "https://blockstream.info/api/address/" + address;
                    nonjson = await getData(url);
                }
            }
        }
    }
    catch(e)
    {
        if(encodedAddressPrefix == 'main')
        {
            url = "https://blockstream.info/api/address/" + address;
            nonjson = await getData(url);
        }
    }

    if (!isValidJson(nonjson)) return false;
    let json = JSON.parse(nonjson);
    if (json["chain_stats"]["tx_count"] > 0 || (includeMempool && json["mempool_stats"]["tx_count"] > 0)) {
        return true;
    }
    return false;
}*/

async function probeAddress(address) {
    let url = "https://mempool.space/" + mempoolNetwork + "api/address/" + address;
    let nonjson = await getData(url);
    console.log('PROBED ADDRESS RESULT', nonjson);
    if (!isValidJson(nonjson)) return false;
    return true;
}

function dotLoop(string) {
    if (!$('.dots')) {
        setTimeout(function () {
            dotLoop(string);
        }, 1000);
        return;
    }
    if (string.length < 3) {
        string = string + ".";
    } else {
        string = ".";
    }
    $('.dots').innerText = string;
    setTimeout(function () {
        dotLoop(string);
    }, 1000);
}

dotLoop(".");

function timer(num) {
    if (!num) {
        $('.timer').style.display = "none";
        return;
    }
    num = num - 1;
    $('.timer').innerText = num;
    setTimeout(function () {
        timer(num);
    }, 1000);
}

function satsToBitcoin(sats) {
    if (sats >= 100000000) sats = sats * 10;
    let string = String(sats).padStart(8, "0").slice(0, -9) + "." + String(sats).padStart(8, "0").slice(-9);
    if (string.substring(0, 1) == ".") string = "0" + string;
    return string;
}

async function satsToDollars(sats) {
    if (sats >= 100000000) sats = sats * 10;
    let bitcoin_price = sessionStorage["bitcoin_price"];
    let value_in_dollars = Number(String(sats).padStart(8, "0").slice(0, -9) + "." + String(sats).padStart(8, "0").slice(-9)) * bitcoin_price;
    return value_in_dollars;
}

$$('.fee').forEach(function (item) {
    item.onclick = function () {
        $$('.fee .num').forEach(function (item2) {
            item2.style.backgroundColor = "grey";
        });
        this.getElementsByClassName("num")[0].style.backgroundColor = "green";
        sessionStorage["feerate"] = this.getElementsByClassName("num")[0].innerText;
        $('#sats_per_byte').innerText = Number(this.getElementsByClassName("num")[0].innerText);
        $('#sats_range').value = Number(this.getElementsByClassName("num")[0].innerText);
    }
});

function formatNumberString(string, decimals) {

    let pos = string.length - decimals;

    if(decimals == 0) {
        // nothing
    }else
    if(pos > 0){
        string = string.substring(0, pos) + "." + string.substring(pos, string.length);
    }else{
        string = '0.' + ( "0".repeat( decimals - string.length ) ) + string;
    }

    return string;
}

function isValidAddress() {

    if (!isValidTaprootAddress($('.address').value)) {
        return false;
    }

    return true;
}

function isValidAddress2(address) {

    if (!isValidTaprootAddress(address)) {
        return false;
    }

    return true;
}

function checkAddress() {
    if (!isValidAddress()) {
        $('.address').style.backgroundColor = "#ff5252";
        $('.address').style.border = "2px solid red";
    } else {
        $('.address').style.backgroundColor = "initial";
        $('.address').style.border = "1px solid white";
        if(isValidAddress())
        {
            $('#transfer-balance-link').href = 'https://unisat.io/brc20?q=' + $('.address').value;
        }
    }
}

$('.address').onchange = checkAddress;
$('.address').onpaste = checkAddress;
$('.address').onkeyup = checkAddress;

async function isUsedDomain(domain) {
    let data = await getData(`https://api.sats.id/names/${encodeURIComponent(domain)}`);
    console.log("data:", data);
    data = JSON.parse(data);
    console.log("data:", data);
    if ("name" in data) return true;
    if (data["error"] == "Too many requests") return null;
    return false;
}

async function isUsedUnisatDomain(domain) {

    let data = await getData('api/existence.php?text='+encodeURIComponent(domain));

    try
    {
        data = JSON.parse(data);
    }
    catch(e)
    {
        // in case of the api not available or php not being executed, check the text and hope for the best
        let fallback = await isUsedUnisatDomainFallback(':"'+domain+'"');

        if(fallback === false)
        {
            fallback = await isUsedUnisatDomainFallback(domain);
        }

        return fallback;
    }

    if(typeof data.data[domain] == 'undefined' || data.data[domain] == 'available')
    {
        return false;
    }

    return true;
}

async function isUsedUnisatDomainFallback(domain) {

    let data = await getData('api/ob.php?text='+encodeURIComponent(domain));
    console.log("data:", data);
    try
    {
        data = JSON.parse(data);
    }
    catch(e)
    {
        return null;
    }

    if(data.count == 0)
    {
        return false;
    }

    return true;
}

async function checkUnisatDomain() {

    $('.unisat_checker').innerHTML = 'Please wait...';

    let i = 1;
    let registered = [];
    let rate_limited = false;
    let sats_domains = $('.unisat_text').value.split("\n");
    let sats_domains_cleaned = [];

    for (let sats_domain in sats_domains) {

        let domain = sats_domains[sats_domain].trim();

        if (domain == '' || sats_domains_cleaned.includes(domain)) {

            continue;
        }

        sats_domains_cleaned.push(domain);
    }

    for (let sats_domain in sats_domains_cleaned) {

        let domain = sats_domains_cleaned[sats_domain].trim();

        $('.unisat_checker').innerHTML = 'Checking...(' + i + '/' + sats_domains_cleaned.length + ')';

        let isUsed = await isUsedUnisatDomain(domain);

        if (domain && isUsed === true) {

            registered.push(domain);

        } else if (domain && isUsed === null) {

            rate_limited = true;
            break;
        }

        await sleep(1000);

        i++;
    }

    $('.unisat_checker').innerHTML = 'Check availability';

    if (rate_limited) {
        alert('Cannot check any domain availability as a rate limit occurred.');
    }

    if (registered.length != 0) {
        alert('The domain(s) ' + registered.join(', ') + ' is/are already registered.');
    } else {
        alert('All domains are available.');
    }
}


async function checkDomain() {

    $('.dns_checker').innerHTML = 'Please wait...';

    let i = 1;
    let registered = [];
    let rate_limited = false;
    let sats_domains = $('.dns').value.split("\n");
    let sats_domains_cleaned = [];

    for (let sats_domain in sats_domains) {

        let domain = sats_domains[sats_domain].trim();

        if (domain == '' || sats_domains_cleaned.includes(domain)) {

            continue;
        }

        sats_domains_cleaned.push(domain);
    }

    for (let sats_domain in sats_domains_cleaned) {

        let domain = sats_domains_cleaned[sats_domain].trim();

        $('.dns_checker').innerHTML = 'Checking...(' + i + '/' + sats_domains_cleaned.length + ')';

        let isUsed = await isUsedDomain(domain);

        if (domain && isUsed === true) {

            registered.push(domain);

        } else if (domain && isUsed === null) {

            rate_limited = true;
            break;
        }

        await sleep(1000);

        i++;
    }

    $('.dns_checker').innerHTML = 'Check availability';

    if (rate_limited) {
        alert('Cannot check any domain availability as a rate limit occurred.');
    }

    if (registered.length != 0) {
        alert('The domain(s) ' + registered.join(', ') + ' is/are already registered.');
    } else {
        alert('All domains are available.');
    }
}

$('.unisat_checker').onclick = checkUnisatDomain;
$('.dns_checker').onclick = checkDomain;
$('#bytes_checker').onclick = async function () {
    $('#bytes_checker').innerHTML = 'Please wait...';

    let inscribed_already = [];
    let errors = [];

    for (let i = 0; i < files.length; i++) {
        $('#bytes_checker').innerHTML = 'Please wait...(' + (i + 1) + '/' + files.length + ')';

        let hash_result = await getData('api/ob.php?hash=' + files[i].sha256);

        console.log(hash_result);

        try {
            hash_result = JSON.parse(hash_result);

            if (hash_result.results.length != 0) {
                inscribed_already.push(files[i].name);
            }
        } catch (e) {
            errors.push(files[i].name);
        }
        await sleep(1000);
    }

    if (inscribed_already.length != 0) {
        alert("The following files are inscribed already: " + inscribed_already.join(', '));
    }

    if (errors.length != 0) {
        alert("Could not check the following files due to an error: " + inscribed_already.join(', '));
    }

    if (inscribed_already.length == 0) {
        alert("Your files seem not to be inscribed yet.");
    }

    $('#bytes_checker').innerHTML = 'Check if file(s) are inscribed already';
}

async function init(num) {

    if (!num) {
        let isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) $('.safari_warning').style.display = "block";
        let minfee = await getMinFeeRate();
        $('#sats_per_byte').innerText = minfee;
        $('#sats_range').value = minfee;
    }
    num = num + 1;
    let allrates = await getAllFeeRates();
    $('.minfee .num').innerText = allrates["minimumFee"];
    $('.midfee .num').innerText = allrates["hourFee"];
    $('.maxfee .num').innerText = allrates["fastestFee"];
    let isgreen;
    $$('.fee .num').forEach(function (item) {
        if (item.style.backgroundColor == "green" || getComputedStyle(item).backgroundColor == "rgb(0, 128, 0)") isgreen = item;
    });
    if (isgreen) {
        $('#sats_per_byte').innerText = Number(isgreen.innerText);
        $('#sats_range').value = Number(isgreen.innerText);
        sessionStorage["feerate"] = isgreen.innerText;
    }
    sessionStorage["bitcoin_price"] = await getBitcoinPrice();
    await waitSomeSeconds(10);
    init(num);
}

function encodeBase64(file) {
    return new Promise(function (resolve, reject) {
        let imgReader = new FileReader();
        imgReader.onloadend = function () {
            resolve(imgReader.result.toString());
        }
        imgReader.readAsDataURL(file);
    });
}

function base64ToHex(str) {
    const raw = atob(str);
    let result = '';
    for (let i = 0; i < raw.length; i++) {
        const hex = raw.charCodeAt(i).toString(16);
        result += (hex.length === 2 ? hex : '0' + hex);
    }
    return result.toLowerCase();
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBytes(hex) {
    return Uint8Array.from(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}

function bytesToHex(bytes) {
    return bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");
}

function textToHex(text) {
    var encoder = new TextEncoder().encode(text);
    return [...new Uint8Array(encoder)]
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");
}

function createQR(content) {
    let dataUriPngImage = document.createElement("img"),
        s = QRCode.generatePNG(content, {
            ecclevel: "M",
            format: "html",
            fillcolor: "#FFFFFF",
            textcolor: "#000000",
            margin: 4,
            modulesize: 8,
        });
    dataUriPngImage.src = s;
    dataUriPngImage.id = "qr_code";
    return dataUriPngImage;
}

async function getBitcoinPriceFromCoinbase() {
    let data = await getData("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    let json = JSON.parse(data);
    let price = json["data"]["amount"];
    return price;
}

async function getBitcoinPriceFromKraken() {
    let data = await getData("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
    let json = JSON.parse(data);
    let price = json["result"]["XXBTZUSD"]["a"][0];
    return price;
}

async function getBitcoinPriceFromCoindesk() {
    let data = await getData("https://api.coindesk.com/v1/bpi/currentprice.json");
    let json = JSON.parse(data);
    let price = json["bpi"]["USD"]["rate_float"];
    return price;
}

async function getBitcoinPriceFromGemini() {
    let data = await getData("https://api.gemini.com/v2/ticker/BTCUSD");
    let json = JSON.parse(data);
    let price = json["bid"];
    return price;
}

async function getBitcoinPriceFromBybit() {
    let data = await getData("https://api-testnet.bybit.com/derivatives/v3/public/order-book/L2?category=linear&symbol=BTCUSDT");
    let json = JSON.parse(data);
    let price = json["result"]["b"][0][0];
    return price;
}

async function getBitcoinPrice() {
    let prices = [];
    let cbprice = await getBitcoinPriceFromCoinbase();
    let kprice = await getBitcoinPriceFromKraken();
    let cdprice = await getBitcoinPriceFromCoindesk();
    let gprice = await getBitcoinPriceFromGemini();
    //let bprice = await getBitcoinPriceFromBybit();
    prices.push(Number(cbprice), Number(kprice), Number(cdprice), Number(gprice)/*, Number(bprice)*/);
    prices.sort();
    return prices[2];
}

init(0);