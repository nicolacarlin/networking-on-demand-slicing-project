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

var current_slice = "default";

var elem = {
    force: d3.layout.force()
        .size([CONF.force.width, CONF.force.height])
        .charge(CONF.force.charge)
        .linkDistance(CONF.force.dist)
        .on("tick", _tick),
    svg: d3.select("body").append("svg")
        .attr("id", "topology")
        .attr("width", CONF.force.width)
        .attr("height", CONF.force.height),
    console: d3.select("body").append("div")
        .attr("id", "console")
        .attr("width", CONF.force.width)
};
function _tick() {
    elem.link.attr("x1", function (d) { return d.source.x; })
        .attr("y1", function (d) { return d.source.y; })
        .attr("x2", function (d) { return d.target.x; })
        .attr("y2", function (d) { return d.target.y; });

    elem.node.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });

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
            //if (!is_valid_link(links[i])) continue;
            //console.log("add link: " + JSON.stringify(links[i]));

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
            //console.log("delete switch: " + JSON.stringify(nodes[i]));

            node_index = this.get_node_index(nodes[i]);
            this.nodes.splice(node_index, 1);
        }
        this.refresh_node_index();
    },
    delete_links: function (links) {
        for (var i = 0; i < links.length; i++) {
            if (!is_valid_link(links[i])) continue;
            //console.log("delete link: " + JSON.stringify(links[i]));

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
        var x1 = link.source.x;
        var y1 = link.source.y;
        var x2 = link.target.x;
        var y2 = link.target.y;

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
    d3.select("svg").selectAll("*").remove();

    fetch("/v1.0/topology/switches", {method: "GET"})
        .then((response) => response.json()).then((switches) => {
            
            fetch("/v1.0/topology/hosts", {method: "GET"})
                .then((response) => response.json()).then((hosts) => {

                    fetch("/v1.0/topology/links", {method: "GET"})
                        .then((response) => response.json()).then((links) => {

                            fetch("/api/v1/activeSlice", {method: "GET"})
                                .then((response) => response.json()).then((active_links) => {

                                    links = parse_active_liks(active_links["message"], links);
                                    hosts_links = []
                                    //Sort hosts and switches to replicate connection
                                    hosts.sort((a, b) => a.mac > b.mac);
                                    switches.sort((a, b) => a.dpid > b.dpid);

                                    for (var i = 0; i < hosts.length; i++) {
                                        link = { src: { dpid: "h" + (i + 1), hw_addr: hosts[i].mac, name: "h" + (i + 1) + "-s" + (i + 1), port_no: "00000001" }, dst: { dpid: switches[i].dpid, hw_addr: switches[i].ports[0].hw_addr, name: switches[i].ports[0].name, port_no: switches[i].ports[0].port_no } }
                                        hosts_links.push(link);
                                        hosts[i].dpid = "h" + (i + 1);
                                    }
                                    topo.initialize({ switches: switches, links: links, hosts: hosts, hosts_links: hosts_links });
                                    elem.update();
                            });
                    });
            });
    });
}

function initialize_buttons() {
    fetch("/api/v1/slices", {method: "GET"})
        .then((response) => response.json()).then((res) => {
            var slices = res["message"];
            let slices_div = document.getElementById("slices");
            for (var i = 0; i < slices.length; i++) {
                const button = document.createElement("button");
                button.textContent = slices[i];
                button.className = "button";
                button.setAttribute("id", slices[i]);
                button.onclick = function () {
                    fetch("/api/v1/slice/" + button.innerText, {method: "GET"})
                        .then((response) => response.json()).then((res) => {
                            if (res["status"] == "success") {
                                current_slice = button.innerText;
                                initialize_topology();
                            } else {
                                alert(res["message"])
                            }
                    });
                }
                slices_div.appendChild(button);
            }
    });
}

// Object { status: "error", message: "Slice not present." }
// Object { status: "success", message: "Slice deleted" }

function delete_slice(slice_to_delete) {
    fetch("/api/v1/sliceDeletion/" + slice_to_delete, {method: "DELETE"})
        .then((response) => response.json()).then((res) => {
            if (res["status"] == "success") {
                var button_to_delete = document.getElementById(slice_to_delete);
                button_to_delete.remove();

                if (current_slice == slice_to_delete){
                    current_slice = "default";
                    initialize_topology();
                }
            }
            alert(res["message"])
        });
}

function main() {
    initialize_topology();
    initialize_buttons();
}

main();
