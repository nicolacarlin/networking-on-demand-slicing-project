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

var positions = {
    "0000000000000001" : {"x" : "450", "y" : "200"},
    "0000000000000002" : {"x" : "250", "y" : "300"},
    "0000000000000003" : {"x" : "650", "y" : "300"},
    "0000000000000004" : {"x" : "250", "y" : "500"},
    "0000000000000005" : {"x" : "650", "y" : "500"},
    "0000000000000006" : {"x" : "450", "y" : "600"},
    "h1" : {"x" : "450", "y" : "50"},
    "h2" : {"x" : "100", "y" : "300"},
    "h3" : {"x" : "800", "y" : "300"},
    "h4" : {"x" : "100", "y" : "500"},
    "h5" : {"x" : "800", "y" : "500"},
    "h6" : {"x" : "450", "y" : "750"}
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

elem.drag = elem.force.drag().on("dragstart", _dragstart);
function _dragstart(d) {
    var dpid = dpid_to_int(d.dpid)
    d3.json("/stats/flow/" + dpid, function (e, data) {
        flows = data[dpid];
        elem.console.selectAll("ul").remove();
    });
    d3.select(this).classed("fixed", d.fixed = true);
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
        //.attr("transform", function(d) { return "translate(-100, -100)" })
        .on("dblclick", function (d) { d3.select(this).classed("fixed", d.fixed = false); })
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

    var ports = topo.get_ports();
    this.port.remove();
    this.port = this.svg.selectAll(".port").data(ports);
    var portEnter = this.port.enter().append("g")
        .attr("class", "port");
    portEnter.append("circle")
        .attr("r", 8);
    portEnter.append("text")
        .attr("dx", -3)
        .attr("dy", 3)
        .text(function (d) { return trim_zero(d.port_no); });
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

function parse_active_liks(active_links, links) {
    for (var i = 0; i < links.length; i++) {
        var src_switch = parseInt(links[i]["src"]["dpid"]);
        var src_port = parseInt(links[i]["src"]["port_no"]);
        var dst_switch = parseInt(links[i]["dst"]["dpid"]);
        var dst_port = parseInt(links[i]["dst"]["port_no"]);

        if (active_links[src_switch].includes(src_port) && active_links[dst_switch].includes(dst_port)) {
            links[i]["Status"] = 1;
        } else {
            links[i]["Status"] = 0;
        }
        //console.log("src switch: " + src_switch + " - src port: " + src_port + " - dst switch: " + dst_switch + " - dst port: " + dst_port + " - status: " + links[i]["Status"])
    }

    return links
}

function initialize_topology() {
    // Clear canvas before setting the slice image
    d3.select("svg").selectAll("*").remove();
    fetch("/v1.0/topology/switches", { method: "GET" })
        .then((response) => response.json()).then((switches) => {

            fetch("/v1.0/topology/hosts", { method: "GET" })
                .then((response) => response.json()).then((hosts) => {

                    fetch("/v1.0/topology/links", { method: "GET" })
                        .then((response) => response.json()).then((links) => {

                            fetch("/api/v1/activeSlice", { method: "GET" })
                                .then((response) => response.json()).then((active_links) => {

                                    if (active_links["status"] == "success") {
                                        // Set status to links to replicate the slice
                                        links = parse_active_liks(active_links["message"], links);
                                        hosts_links = []
                                        // Sort host and switches
                                        hosts.sort((a, b) => a.mac > b.mac);
                                        switches.sort((a, b) => a.dpid > b.dpid);
                                        // Add host links
                                        for (var i = 0; i < hosts.length; i++) {
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
                                        // Set slice name
                                        fetch("/api/v1/activeSliceName", { method: "GET" })
                                            .then((response) => response.json()).then((res) => {
                                                if (res["status"] == "success") {
                                                    current_slice = res["message"];
                                                } else {
                                                    alert("Impossible to set slice name, please refresh the page");
                                                }
                                            });
                                        // Initialize topology and create image in canvas
                                        topo.initialize({ switches: switches, links: links, hosts: hosts, hosts_links: hosts_links });
                                        elem.update();
                                    } else {
                                        alert("Something went wrong, please refresh the page");
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
                            .then((response) => response).then((res) => {
                                current_slice = button.innerText;
                                initialize_topology();
                            });
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
            "qos": []
        }
    };

    // For each checked checkbox insert 6 in the corresponding port array (forward to host)
    for (var i = 1; i < 7; i++) {
        for (var j = 1; j < 7; j++) {
            if (i != j) {
                current_checkbox = document.getElementById("check:" + i + "-" + j);
                if (current_checkbox.checked) {
                    slice["slice"]["rules"]["" + i][port_map[i + "-" + j]].push(6);
                }
            }
        }
    }

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
                    .then((response) => response).then((res) => {
                        current_slice = button.innerText;
                        initialize_topology();
                    });
            }
            // Set new current slice, save it, close the prompt and refresh the canvas
            slices_div.appendChild(button);
            current_slice = slice_name;
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
