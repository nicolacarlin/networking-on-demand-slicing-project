var CONF = {
    image: {
        width: 50,
        height: 40
    },
    force: {
        width: 900,
        height: 800,
        dist: 400,
        charge: -600
    }
};

// element positions inside the canvas
var positions = {
    "0000000000000001": { "x": "450", "y": "200" },
    "0000000000000002": { "x": "250", "y": "300" },
    "0000000000000003": { "x": "650", "y": "300" },
    "0000000000000004": { "x": "250", "y": "500" },
    "0000000000000005": { "x": "650", "y": "500" },
    "0000000000000006": { "x": "450", "y": "600" },
    "h1": { "x": "450", "y": "50" },
    "h2": { "x": "100", "y": "300" },
    "h3": { "x": "800", "y": "300" },
    "h4": { "x": "100", "y": "500" },
    "h5": { "x": "800", "y": "500" },
    "h6": { "x": "450", "y": "750" }
}

// map of the ports, given src-dst switches returns the src port
var port_map = {
    "1-2": "1", "1-3": "2", "1-4": "3", "1-5": "4", "1-6": "5",
    "2-1": "1", "2-3": "2", "2-4": "3", "2-5": "4", "2-6": "5",
    "3-1": "1", "3-2": "2", "3-4": "3", "3-5": "4", "3-6": "5",
    "4-1": "1", "4-2": "2", "4-3": "3", "4-5": "4", "4-6": "5",
    "5-1": "1", "5-2": "2", "5-3": "3", "5-4": "4", "5-6": "5",
    "6-1": "1", "6-2": "2", "6-3": "3", "6-4": "4", "6-5": "5"
};

var existing_slices = [];
var current_slice = "default";

var ws = new WebSocket("ws://" + location.host + "/v1.0/topology/ws");
ws.onmessage = function (event) {
    var data = JSON.parse(event.data);

    var result = rpc[data.method](data.params);

    var ret = { "id": data.id, "jsonrpc": "2.0", "result": result };
    this.send(JSON.stringify(ret));
}

function trim_zero(obj) {
    return String(obj).replace(/^0+/, "");
}

function dpid_to_int(dpid) {
    return Number("0x" + dpid);
}

var elem = {
    force: d3.layout.force()
        .size([CONF.force.width, CONF.force.height])
        .charge(CONF.force.charge)
        .linkDistance(CONF.force.dist)
        .on("tick", _tick),
    svg: d3.select("body").append("svg")
        .attr("id", "topology")
        .attr("preserveAspectRatio", "xMinYMin meet")
        .attr("width", CONF.force.width)
        .attr("height", CONF.force.height),
    console: d3.select("body").append("div")
        .attr("id", "console")
        .attr("width", CONF.force.width)
};

function _tick() {
    elem.link.attr("x1", function (d) { return positions[d.source.dpid].x; })
        .attr("y1", function (d) { return positions[d.source.dpid].y; })
        .attr("x2", function (d) { return positions[d.target.dpid].x; })
        .attr("y2", function (d) { return positions[d.target.dpid].y; });

    elem.node.attr("transform", function (d) { return "translate(" + positions[d.dpid].x + "," + positions[d.dpid].y + ")"; });

    elem.port.attr("transform", function (d) {
        var p = topo.get_port_point(d);
        return "translate(" + p.x + "," + p.y + ")";
    });
}

// when clicking on a switch the qos is returned and printed
elem.drag = elem.force.drag().on("dragstart", _dragstart);
function _dragstart(d) {
    var output = "";
    document.getElementById("qosResults").innerHTML = output;
    fetch("/qos/queue/" + d.dpid, { method: "GET" })
        .then((response) => response.json()).then((queues) => {
            // Print default queue idx=0
            default_rate = queues[0]["command_result"]["details"]["s" + dpid_to_int(d.dpid) + "-eth6"][0]["config"]["max-rate"];
            if (default_rate !== undefined) {
                output += "Default bandwidth: 10Mb";
                output += "\n";
                output += "Default queue:\tMax rate: " + default_rate;
                output += "\n";
            }
            fetch("/qos/rules/" + d.dpid, { method: "GET" })
                .then((response) => response.json())
                .then((rules) => {
                    var rules = rules[0]["command_result"][0]["qos"];
                    // Print queues related to rules
                    for (var i = 0; i < rules.length; i++) {
                        if ("nw_src" in rules[i]) {
                            var src = rules[i]["nw_src"];
                            var dst = rules[i]["nw_dst"];
                            var actions = rules[i]["actions"];

                            output += "From h" + src.split(".")[3] + " to h" + dst.split(".")[3] + ": ";

                            for (var j = 0; j < actions.length; j++) {
                                if ("queue" in actions[j]) {
                                    var queue = actions[j]["queue"];

                                    var config = queues[0]["command_result"]["details"]["s" + dpid_to_int(d.dpid) + "-eth6"][queue]["config"];
                                    if ("max-rate" in config) {
                                        output += "\tMax rate: " + config["max-rate"];
                                    }
                                    if ("min-rate" in config) {
                                        output += "\tMin rate: " + config["min-rate"];
                                    }
                                    output += "\n";
                                }
                            }
                        }
                    }
                })
                .finally(() => document.getElementById("qosResults").innerHTML = output);
        });
    // d3.json("/stats/flow/" + dpid, function (e, data) {
    //     flows = data[dpid];
    //     elem.console.selectAll("ul").remove();
    // });
    //d3.select(this).classed("fixed", d.fixed = true);
}

elem.node = elem.svg.selectAll(".node");
elem.link = elem.svg.selectAll(".link");
elem.port = elem.svg.selectAll(".port");
elem.update = function () {
    elem.node = elem.svg.selectAll(".node");
    elem.link = elem.svg.selectAll(".link");
    elem.port = elem.svg.selectAll(".port");
    this.force
        .nodes(topo.nodes)
        .links(topo.links)
        .start();

    this.link = this.link.data(topo.links);
    this.link.exit().remove();
    var linkEnter = this.link.enter().append("line").call(this.drag);
    linkEnter.filter(function (d) { return d.status != 0; }).attr("class", "activeLink");
    linkEnter.filter(function (d) { return d.status == 0; }).attr("class", "disabledLink");

    this.node = this.node.data(topo.nodes);
    this.node.exit().remove();
    var nodeEnter = this.node.enter().append("g")
        .attr("class", "node")
        .on("dblclick", function (d) { console.log(d); })
        .call(this.drag);

    nodeEnter.filter(function (d) { return d.dpid.startsWith("h"); }).append("image")
        .attr("xlink:href", "./images/host.svg")
        .attr("x", -CONF.image.width / 2)
        .attr("y", -CONF.image.height / 2)
        .attr("width", CONF.image.width)
        .attr("height", CONF.image.height);

    nodeEnter.filter(function (d) { return !d.dpid.startsWith("h"); }).append("image")
        .attr("xlink:href", "./images/switch.svg")
        .attr("x", -CONF.image.width / 2)
        .attr("y", -CONF.image.height / 2)
        .attr("width", CONF.image.width)
        .attr("height", CONF.image.height);

    nodeEnter.append("text")
        .attr("dx", -CONF.image.width / 2)
        .attr("dy", CONF.image.height - 10)
        .text(function (d) { return "dpid: " + trim_zero(d.dpid); });

    // var ports = topo.get_ports();
    // this.port.remove();
    // this.port = this.svg.selectAll(".port").data(ports);
    // var portEnter = this.port.enter().append("g")
    //     .attr("class", "port");
    // portEnter.append("circle")
    //     .attr("r", 8);
    // portEnter.append("text")
    //     .attr("dx", -3)
    //     .attr("dy", 3)
    //     .text(function (d) { return trim_zero(d.port_no); });
};

function is_valid_link(link) {
    return (link.src.dpid < link.dst.dpid)
}

var topo = {
    nodes: [],
    links: [],
    node_index: {}, // dpid -> index of nodes array
    initialize: function (data) {
        this.nodes = [];
        this.links = [];
        this.node_index = {};
        this.add_nodes(data.switches);
        this.add_nodes(data.hosts);
        this.add_links(data.links);
        this.add_links(data.hosts_links);
    },
    add_nodes: function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
            this.nodes.push(nodes[i]);
        }
        this.refresh_node_index();
    },
    add_links: function (links) {
        for (var i = 0; i < links.length; i++) {
            var src_dpid = links[i].src.dpid;
            var dst_dpid = links[i].dst.dpid;
            var src_index = this.node_index[src_dpid];
            var dst_index = this.node_index[dst_dpid];
            var link = {
                source: src_index,
                target: dst_index,
                status: links[i]["Status"],
                port: {
                    src: links[i].src,
                    dst: links[i].dst
                }
            }
            this.links.push(link);
        }
    },
    delete_nodes: function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
            node_index = this.get_node_index(nodes[i]);
            this.nodes.splice(node_index, 1);
        }
        this.refresh_node_index();
    },
    delete_links: function (links) {
        for (var i = 0; i < links.length; i++) {
            if (!is_valid_link(links[i])) continue;
            link_index = this.get_link_index(links[i]);
            this.links.splice(link_index, 1);
        }
    },
    get_node_index: function (node) {
        for (var i = 0; i < this.nodes.length; i++) {
            if (node.dpid == this.nodes[i].dpid) {
                return i;
            }
        }
        return null;
    },
    get_link_index: function (link) {
        for (var i = 0; i < this.links.length; i++) {
            if (link.src.dpid == this.links[i].port.src.dpid &&
                link.src.port_no == this.links[i].port.src.port_no &&
                link.dst.dpid == this.links[i].port.dst.dpid &&
                link.dst.port_no == this.links[i].port.dst.port_no) {
                return i;
            }
        }
        return null;
    },
    get_ports: function () {
        var ports = [];
        var pushed = {};
        for (var i = 0; i < this.links.length; i++) {
            function _push(p, dir) {
                key = p.dpid + ":" + p.port_no;
                if (key in pushed) {
                    return 0;
                }

                pushed[key] = true;
                p.link_idx = i;
                p.link_dir = dir;
                return ports.push(p);
            }
            _push(this.links[i].port.src, "source");
            _push(this.links[i].port.dst, "target");
        }

        return ports;
    },
    get_port_point: function (d) {
        var weight = 0.88;

        var link = this.links[d.link_idx];
        var x1 = positions[link.source.dpid].x;
        var y1 = positions[link.source.dpid].y;
        var x2 = positions[link.target.dpid].x;
        var y2 = positions[link.target.dpid].y;

        if (d.link_dir == "target") weight = 1.0 - weight;

        var x = x1 * weight + x2 * (1.0 - weight);
        var y = y1 * weight + y2 * (1.0 - weight);

        return { x: x, y: y };
    },
    refresh_node_index: function () {
        this.node_index = {};
        for (var i = 0; i < this.nodes.length; i++) {
            this.node_index[this.nodes[i].dpid] = i;
        }
    },
}

var rpc = {
    event_switch_enter: function (params) {
        var switches = [];
        for (var i = 0; i < params.length; i++) {
            switches.push({ "dpid": params[i].dpid, "ports": params[i].ports });
        }
        topo.add_nodes(switches);
        //elem.update();
        return "";
    },
    event_switch_leave: function (params) {
        var switches = [];
        for (var i = 0; i < params.length; i++) {
            switches.push({ "dpid": params[i].dpid, "ports": params[i].ports });
        }
        topo.delete_nodes(switches);
        // elem.update();
        return "";
    },
    event_link_add: function (links) {
        topo.add_links(links);
        //elem.update();
        return "";
    },
    event_link_delete: function (links) {
        topo.delete_links(links);
        //elem.update();
        return "";
    },
}

// function to set the status value to links
// active links are displayed as green and disabled ones as grey
function parse_active_liks(active_links, links) {
    for (var i = 0; i < links.length; i++) {
        var src_switch = parseInt(links[i]["src"]["dpid"]);
        var src_port = parseInt(links[i]["src"]["port_no"]);
        var dst_switch = parseInt(links[i]["dst"]["dpid"]);
        var dst_port = parseInt(links[i]["dst"]["port_no"]);

        // if the link is active set status to 1 otherwise set it to 0
        links[i]["Status"] = (active_links[src_switch] != undefined && active_links[dst_switch] != undefined)
            && ((active_links[src_switch].includes(src_port) && active_links[dst_switch].includes(dst_port))) ? 1 : 0;
    }

    return links
}

// function to retrieve informations and draw the image
function initialize_topology() {
    // Clear canvas before setting the slice image
    d3.select("svg").selectAll("*").remove();
    // request the switches
    fetch("/v1.0/topology/switches", { method: "GET" })
        .then((response) => response.json()).then((switches) => {
            // request the hosts
            fetch("/v1.0/topology/hosts", { method: "GET" })
                .then((response) => response.json()).then((hosts) => {
                    // request the links
                    fetch("/v1.0/topology/links", { method: "GET" })
                        .then((response) => response.json()).then((links) => {
                            // request the active slice
                            fetch("/api/v1/activeSlice", { method: "GET" })
                                .then((response) => response.json()).then((active_links) => {

                                    if (active_links["status"] == "success") {
                                        // Set status to links to replicate the slice
                                        links = parse_active_liks(active_links["message"]["slice"], links);
                                        hosts_links = []
                                        // Sort host and switches
                                        hosts.sort((a, b) => a.mac > b.mac);
                                        switches.sort((a, b) => a.dpid > b.dpid);
                                        // Add host links
                                        for (var i = 0; i < hosts.length; i++) {
                                            if (switches[i] != undefined && hosts[i] != undefined) {
                                                let link = {
                                                    src: {
                                                        dpid: "h" + (i + 1),
                                                        hw_addr: hosts[i].mac,
                                                        name: "h" + (i + 1) + "-s" + (i + 1),
                                                        port_no: "00000001"
                                                    },
                                                    dst: {
                                                        dpid: switches[i].dpid,
                                                        hw_addr: switches[i].ports[0].hw_addr,
                                                        name: switches[i].ports[0].name,
                                                        port_no: switches[i].ports[0].port_no
                                                    }
                                                }
                                                hosts_links.push(link);
                                                hosts[i].dpid = "h" + (i + 1);
                                            }
                                        }
                                        current_slice = active_links["message"]["slice_name"];
                                        document.getElementById("sliceName").innerText = "Current slice: " + current_slice;
                                        // Initialize topology and create image in canvas
                                        topo.initialize({ switches: switches, links: links, hosts: hosts, hosts_links: hosts_links });
                                        document.getElementById("qosResults").innerHTML = "Click on a switch to check the applied rules";
                                        elem.update();
                                    } else {
                                        alert("Something went wrong, please refresh the page and restart mininet");
                                    }
                                });
                        });
                });
        });
}

// Create slice buttons dinamically
function initialize_buttons() {
    fetch("/api/v1/slices", { method: "GET" })
        .then((response) => response.json()).then((res) => {
            if (res["status"] == "success") {
                existing_slices = res["message"];
                let slices_div = document.getElementById("slices");
                // For each slice in the slices.json file create a button
                for (var i = 0; i < existing_slices.length; i++) {
                    const button = document.createElement("button");
                    button.textContent = existing_slices[i];
                    button.className = "button";
                    button.setAttribute("id", existing_slices[i]);
                    // Set onclick function to change slice
                    button.onclick = function () {
                        fetch("/api/v1/slice/" + button.innerText, { method: "GET" })
                            .then((response) => response).then((res) => { initialize_topology(); });
                    }
                    slices_div.appendChild(button);
                }
            }
        });
}

// Delete a slice and the relative button
function delete_slice(slice_to_delete) {
    fetch("/api/v1/sliceDeletion/" + slice_to_delete, { method: "DELETE" })
        .then((response) => response.json()).then((res) => {
            if (res["status"] == "success") {
                var button_to_delete = document.getElementById(slice_to_delete);
                button_to_delete.remove();
                var index = existing_slices.indexOf(slice_to_delete);
                existing_slices = existing_slices.splice(index, 1);
                // If the delete slice is the selected one, reset to default
                if (current_slice == slice_to_delete) {
                    current_slice = "default";
                    initialize_topology();
                }
            } else {
                alert(res["message"])
            }
        });
}

function custom_switch(value) {
    var ret = 0;
    switch (value) {
        case "100kb":
            ret = 100000;
            break;
        case "300kb":
            ret = 300000;
            break;
        case "500kb":
            ret = 500000;
            break;
        case "800kb":
            ret = 800000;
            break;
        case "1Mb":
            ret = 1000000;
            break;
        case "5Mb":
            ret = 5000000;
            break;
        default:
            ret = 0;
            break;
    }
    return ret;
}

// Create a new slice and set it as selected
function create_slice(slice_name) {

    if (existing_slices.includes(slice_name)) {
        alert("Slice name already exists, please change name");
        return;
    }

    // Empty slice format
    var slice = {
        "name": slice_name,
        "slice": {
            "rules": {
                "1": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                "2": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                "3": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                "4": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                "5": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                "6": { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] }
            },
            "qos": [
                { "sw_id": 1, "port": "s1-eth6", "match": [], "queues": [] },
                { "sw_id": 2, "port": "s2-eth6", "match": [], "queues": [] },
                { "sw_id": 3, "port": "s3-eth6", "match": [], "queues": [] },
                { "sw_id": 4, "port": "s4-eth6", "match": [], "queues": [] },
                { "sw_id": 5, "port": "s5-eth6", "match": [], "queues": [] },
                { "sw_id": 6, "port": "s6-eth6", "match": [], "queues": [] }
            ]
        }
    };

    // For each checked checkbox insert 6 in the corresponding port array (forward to host)
    for (var i = 1; i < 7; i++) {
        for (var j = 1; j < 7; j++) {
            if (i != j) {
                let current_checkbox = document.getElementById("check:" + i + "-" + j);
                if (current_checkbox.checked) {
                    slice["slice"]["rules"]["" + i][port_map[i + "-" + j]].push(6);
                    // Add default rule idx=0
                    slice["slice"]["qos"][i - 1]["queues"][0] = { "max_rate": "7000000" }; //7Mb
                }

                // retrieve max and min bandwidth
                var minBW_elem = document.getElementById("minBW:" + i + "-" + j);
                var maxBW_elem = document.getElementById("maxBW:" + i + "-" + j);
                var minBW = custom_switch(minBW_elem.options[minBW_elem.selectedIndex].text);
                var maxBW = custom_switch(maxBW_elem.options[maxBW_elem.selectedIndex].text);

                
                if (minBW != 0 && maxBW != 0) {
                    // if maxBW is greater than minBW add both, otherwise add only maxBW
                    if (maxBW > minBW) {
                        slice["slice"]["qos"][i - 1]["match"].push({ "dst": "10.0.0." + i, "src": "10.0.0." + j });
                        slice["slice"]["qos"][i - 1]["queues"].push({ "max_rate": String(maxBW), "min_rate": String(minBW) });
                    } else {
                        slice["slice"]["qos"][i - 1]["match"].push({ "dst": "10.0.0." + i, "src": "10.0.0." + j });
                        slice["slice"]["qos"][i - 1]["queues"].push({ "max_rate": String(maxBW) });
                    }
                } else if (minBW != 0 && maxBW == 0) {
                    // if only minBW is set add only minBW
                    slice["slice"]["qos"][i - 1]["match"].push({ "dst": "10.0.0." + i, "src": "10.0.0." + j });
                    slice["slice"]["qos"][i - 1]["queues"].push({ "min_rate": String(minBW) });
                } else if (minBW == 0 && maxBW != 0) {
                    // if only maxBW is set add only maxBW
                    slice["slice"]["qos"][i - 1]["match"].push({ "dst": "10.0.0." + i, "src": "10.0.0." + j });
                    slice["slice"]["qos"][i - 1]["queues"].push({ "max_rate": String(maxBW) });
                }
            }
        }
    }

    // filter the array to remove queues with no rules
    //slice["slice"]["qos"] = slice["slice"]["qos"].filter(function (element) { return element["match"].length != 0; });

    // For each port and its array if it contains something (6) save that port in the array
    for (var i = 1; i < 7; i++) {
        port_list = []
        for (var j = 1; j < 7; j++) {
            if (slice["slice"]["rules"]["" + i]["" + j].length != 0) {
                port_list.push(j);
            }
        }

        // Again, for each port set all the ports except for it self to avoid forwarding the message to the sender
        for (var k = 1; k < 7; k++) {
            if (k == 6 || slice["slice"]["rules"]["" + i]["" + k].length != 0) {
                slice["slice"]["rules"]["" + i]["" + k] = slice["slice"]["rules"]["" + i]["" + k]
                    .concat(port_list.filter(function (x) { return x != k }));
            }
        }
    }

    for (var i = 1; i < 7; i++) {
        for (var k = 1; k < 7; k++) {
            slice["slice"]["rules"]["" + i]["" + k].sort();
        }
    }

    console.log(slice);

    // Call to create the slice
    fetch("/api/v1/sliceCreation", {
        method: "POST",
        body: JSON.stringify(slice),
        headers: { "Content-type": "application/json; charset=UTF-8" }
    }).then((response) => response.json()).then((res) => {

        if (res["status"] == "success") {
            // Create new button
            let slices_div = document.getElementById("slices");
            const button = document.createElement("button");
            button.textContent = slice_name;
            button.className = "button";
            button.setAttribute("id", slice_name);
            // Set onclick function to change slice
            button.onclick = function () {
                fetch("/api/v1/slice/" + button.innerText, { method: "GET" })
                    .then((response) => response).then((res) => { initialize_topology(); });
            }
            // Set new current slice, save it, close the prompt and refresh the canvas
            slices_div.appendChild(button);
            existing_slices.push(slice_name);
            document.getElementById("modal").classList.remove("open");
            initialize_topology();
        } else {
            alert("Something went wrong");
        }
    });

}

function main() {
    initialize_topology();
    initialize_buttons();
}

main();
