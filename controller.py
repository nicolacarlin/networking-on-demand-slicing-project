import json
import requests
import time 
from webob import Response
from ryu.controller.handler import MAIN_DISPATCHER, CONFIG_DISPATCHER, set_ev_cls
from ryu.ofproto import ofproto_v1_3
from ryu.lib import dpid as dpid_lib
from ryu.lib import stplib
from ryu.lib.packet import packet, ethernet, ether_types

from ryu.app.wsgi import ControllerBase, WSGIApplication, route
from ryu.controller import dpset
from ryu.controller import ofp_event
from ryu.app.simple_switch_13 import SimpleSwitch13

switch_instance_name = 'switch_api_app'
template_file_path = "slices/slices.json"

PERS_REST_ENDPOINT = '/api/v1'
BASE_REST_ENDPOINT = 'http://localhost:8080'
QOS_REST_ENDPOINT = BASE_REST_ENDPOINT+'/qos'
CONFSW_REST_ENDPOINT = BASE_REST_ENDPOINT+'/v1.0/conf/switches/'
OVSDB_ADDR = '\"tcp:127.0.0.1:6632\"'
MAX_BAND =  '10000000' # 10Mb

class Controller(SimpleSwitch13):

    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    _CONTEXTS = {'stplib': stplib.Stp, 'wsgi': WSGIApplication, 'dpset': dpset.DPSet}


    def __init__(self, *args, **kwargs):
        super(Controller, self).__init__(*args, **kwargs)
        self.name = switch_instance_name

        self.dpset = kwargs['dpset']
        self.stp = kwargs['stplib']
        wsgi = kwargs['wsgi']

        self.mac_to_port = {}

        #Load the json file with template slices
        self.sliceConfigs = json.load(open(template_file_path))

        self.sliceName = "default"
        #Setup the default slice
        self.sliceToPort = self.sliceConfigs[self.sliceName]

        #Setup the switch default config for STP
        config = {
                    dpid_lib.str_to_dpid('0000000000000001'): {
                    'bridge': {'priority': 0x8000, 'max_age':60, 'fwd_delay': 2}},                                 
                    dpid_lib.str_to_dpid('0000000000000002'):
                    {'bridge': {'priority': 0x8000,'max_age':60, 'fwd_delay': 2}},
                    dpid_lib.str_to_dpid('0000000000000003'):
                    {'bridge': {'priority': 0x8000, 'max_age':60, 'fwd_delay': 2}},
                    dpid_lib.str_to_dpid('0000000000000004'):
                    {'bridge': {'priority': 0x8000, 'max_age':60, 'fwd_delay': 2}},
                    dpid_lib.str_to_dpid('0000000000000005'):
                    {'bridge': {'priority': 0x8000, 'max_age':60, 'fwd_delay': 2}},
                    dpid_lib.str_to_dpid('0000000000000006'):
                    {'bridge': {'priority': 0x8000, 'max_age':60, 'fwd_delay': 2}}}


        # Register the STP configuration
        self.stp.set_config(config)

        # Register the REST API
        wsgi.register(TopoController, {switch_instance_name: self})

    # Add table_id=1 to manage QoS
    # As defined in the documentation
    # https://techhub.hpe.com/eginfolib/networking/docs/switches/5950/5200-4024_openflow_cg/content/499752685.htm
    def add_flow(self, datapath, priority, match, actions, buffer_id=None):
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser

        inst = [parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS,
                                             actions)]
        if buffer_id:
            mod = parser.OFPFlowMod(datapath=datapath, table_id=1, buffer_id=buffer_id,
                                    priority=priority, match=match,
                                    instructions=inst)
        else:
            mod = parser.OFPFlowMod(datapath=datapath, table_id=1, priority=priority,
                                    match=match, instructions=inst)
        datapath.send_msg(mod)

    #Default method
    def delete_flow(self, datapath):

        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser

        for dst in self.mac_to_port[datapath.id].keys():
            match = parser.OFPMatch(eth_dst=dst)
            mod = parser.OFPFlowMod(
                datapath, command=ofproto.OFPFC_DELETE,
                out_port=ofproto.OFPP_ANY, out_group=ofproto.OFPG_ANY,
                priority=1, match=match, table_id=1)
            datapath.send_msg(mod)

    @set_ev_cls(stplib.EventPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        msg = ev.msg
        datapath = msg.datapath
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser
        in_port = msg.match['in_port']

        pkt = packet.Packet(msg.data)
        eth = pkt.get_protocols(ethernet.ethernet)[0]

        dst = eth.dst
        src = eth.src

        dpid = datapath.id
        self.mac_to_port.setdefault(dpid, {})

        # Ignore LLDP packets - they are used for topology discovery
        if eth.ethertype == ether_types.ETH_TYPE_LLDP:  
            return

        # Check if the communication is allowed
        if str(in_port) in self.sliceToPort["rules"][str(dpid)]: 
            # Learn a mac address to avoid FLOOD next time.
            self.mac_to_port[dpid][src] = in_port

            #self.logger.info(f"DPID: {dpid}, SRC: {src}, DST: {dst}, IN_PORT: {in_port}, MAC_TO_PORT[dpid] {self.mac_to_port[dpid]}, self.mac_to_port[dpid][dst]:")
            # If the destination is known, send the packet to the destination
            if dst in self.mac_to_port[dpid] and self.mac_to_port[dpid][dst] in self.sliceToPort["rules"][str(dpid)][str(in_port)]:
                out_port = [self.mac_to_port[dpid][dst]]
            else:
                # Flood the packet to all possible ports (based on the slice restrictions)
                out_port = self.sliceToPort["rules"][str(dpid)][str(in_port)]
                #self.logger.info("Destination unknown [%s]: switch: %s, flooding on ports: %s", dst, dpid, out_port)

            # Create the actions list: send the packet to each port in out_port
            actions = [parser.OFPActionOutput(int(out)) for out in out_port]

            # install a flow to avoid packet_in next time
            if len(out_port) == 1:
                match = parser.OFPMatch(in_port=in_port, eth_dst=dst, eth_src=src)
                # verify if we have a valid buffer_id, if yes avoid to send both
                # flow_mod & packet_out
                if msg.buffer_id != ofproto.OFP_NO_BUFFER:
                    self.add_flow(datapath, 1, match, actions, msg.buffer_id)
                    self.logger.debug("Flow added")
                    return
                else:
                    self.add_flow(datapath, 1, match, actions)
                    self.logger.debug("Flow added")

            data = None
            if msg.buffer_id == ofproto.OFP_NO_BUFFER:
                data = msg.data

            out = parser.OFPPacketOut(datapath=datapath, buffer_id=msg.buffer_id,
                                in_port=in_port, actions=actions, data=data)
            datapath.send_msg(out)

        elif str(in_port) not in self.sliceToPort[str(dpid)]: 
            # The slice doesn't allow this communication, no action is taken
            self.logger.info("Input port not in the slice, switch %s, in_port: %s, slice_to_port %s", dpid, in_port, self.sliceToPort)
        else: 
            self.logger.info("Standard error")

    #Default method
    @set_ev_cls(stplib.EventTopologyChange, MAIN_DISPATCHER)
    def _topology_change_handler(self, ev):
        dp = ev.dp
        dpid_str = dpid_lib.dpid_to_str(dp.id)
        msg = 'Receive topology change event. Flush MAC table.'
        self.logger.debug("[dpid=%s] %s", dpid_str, msg)

        if dp.id in self.mac_to_port:
            self.delete_flow(dp)
            del self.mac_to_port[dp.id]

    #Default method
    @set_ev_cls(stplib.EventPortStateChange, MAIN_DISPATCHER)
    def _port_state_change_handler(self, ev):
        dpid_str = dpid_lib.dpid_to_str(ev.dp.id)
        of_state = {stplib.PORT_STATE_DISABLE: 'DISABLE',
                    stplib.PORT_STATE_BLOCK: 'BLOCK',
                    stplib.PORT_STATE_LISTEN: 'LISTEN',
                    stplib.PORT_STATE_LEARN: 'LEARN',
                    stplib.PORT_STATE_FORWARD: 'FORWARD'}
        self.logger.debug("[dpid=%s][port=%d] state=%s",
                          dpid_str, ev.port_no, of_state[ev.port_state])
        
    #Method to restart the stp configuration
    def restart_stp(self):
        for bridge in self.stp.bridge_list.values():            
            try:
                #Ask to bridge switch to recalculate STP
                bridge.recalculate_spanning_tree()
            except AttributeError:
                pass
    
    #Calculate the active ports
    def parse_active_ports(self):
        active_ports = {}
        for outer_key, inner_dict in self.sliceToPort["rules"].items():
            for inner_key, value_list in inner_dict.items():
                for value in value_list:
                    #Check if switch (outer_key) is already in the array
                    if outer_key in active_ports and value not in active_ports[outer_key]:
                        active_ports[outer_key].append(value)
                    else: 
                        #if not in the array, add the switch in the array with value the port
                        active_ports[outer_key] = [value]
        return active_ports

    #Method to change the slice
    def _change_slice(self, slicename):
        # Remove all QoS rules
        res = requests.delete(QOS_REST_ENDPOINT+"/rules/all/all", data=json.dumps({"rule_id": "all", "qos_id": "all"}))
        self.logger.info(res)

        # Remove all QoS queues
        for qos_rules in self.sliceConfigs[self.sliceName]["qos"]:
            res = requests.delete(QOS_REST_ENDPOINT+"/queue/"+dpid_lib.dpid_to_str(qos_rules["sw_id"]))
            self.logger.info(res)

        time.sleep(0.5)

        #Change slice
        self.sliceName = slicename
        self.sliceToPort = self.sliceConfigs[self.sliceName]
        #self.mac_to_port = {}

        # Set new QoS
        for qos_rules in self.sliceConfigs[self.sliceName]["qos"]:
            # qos_rules["sw_id"] == dpid of switch
            url = CONFSW_REST_ENDPOINT + dpid_lib.dpid_to_str(qos_rules["sw_id"]) + "/ovsdb_addr"
            res = requests.put(url, data=f"{OVSDB_ADDR}")
            self.logger.info(res)

            time.sleep(0.5)

            # REF: https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.html
            res = requests.post(QOS_REST_ENDPOINT+"/queue/"+dpid_lib.dpid_to_str(qos_rules["sw_id"]), json.dumps({
                "port_name": qos_rules["port"],
                "type": "linux-htb", # default type
                "max_rate": MAX_BAND, # Limit of each link (like TCLink property)
                "queues": qos_rules["queues"] # max_rate and min_rate already specified
                # idx = 0 is the default one of the port specified
            }))
            self.logger.info(res)

            time.sleep(0.5)

            #Add the new QoS
            for index, match in enumerate(qos_rules["match"]): 
                res = requests.post(QOS_REST_ENDPOINT+"/rules/"+dpid_lib.dpid_to_str(qos_rules["sw_id"]), json.dumps({
                    "match": {
                        "nw_dst": match["dst"],
                        "nw_src": match["src"]
                    },
                    "actions": {
                        "queue": index +1 # index of the already defined rule excluding the default one
                    }
                }))
                self.logger.info(res)

                time.sleep(0.5)

        #get the active ports
        active_ports = self.parse_active_ports()

        #Activate the link 
        for bridge in self.stp.bridge_list.values():
            for port in bridge.ports.values():
                #Check if port should be activated
                if ( (str(int(bridge.dpid_str['dpid'])) in active_ports) and (port.ofport.port_no in active_ports[str(int(bridge.dpid_str['dpid']))]) ): 
                    p = self.dpset.get_port(int(bridge.dpid_str['dpid']), port.ofport.port_no)
                    if(port.state == 0):
                        self.logger.info(f"PORT UP: {p}")
                        bridge.link_up(p)
                    

        time.sleep(2)

        #Require STP restart
        stp_restart_required = True

        #Deactivate the other ports
        for bridge in self.stp.bridge_list.values():
            for port in bridge.ports.values():
                #If port is not in active port deactivate the link
                if( (str(int(bridge.dpid_str['dpid'])) in active_ports ) and ( port.ofport.port_no not in active_ports[str(int(bridge.dpid_str['dpid']))]) ): 
                    p = self.dpset.get_port(int(bridge.dpid_str['dpid']), port.ofport.port_no)
                    if(port.state != 0): 
                        if(port.role == 1):
                            #if switch is ROOT, STP is not required to restart
                            stp_restart_required = False
                        self.logger.info(f"PORT DOWN: {p}")
                        bridge.link_down(p)

        #if restart is required, call the appropriate method
        if(stp_restart_required):
            self.logger.info("\n\nRESTART\n\n")
            self.restart_stp()

    # for testing
    def _get_ports(self): 
        for bridge in self.stp.bridge_list.values():
            for port in bridge.ports.values():
                self.logger.info(f"Switch: {bridge.dpid_str['dpid']} -> Port: {port.ofport.port_no} -> Status: {port.state}")          

    # for testing
    def _enable_ports(self): 
        for bridge in self.stp.bridge_list.values():
            for port in bridge.ports.values():
                port._change_status(2)

    # for testing   
    def _disable_ports(self): 
        for bridge in self.stp.bridge_list.values():
            for port in bridge.ports.values():
                self.logger.info("** Disabled**") 
                port._change_status(0)

class TopoController(ControllerBase):
    def __init__(self, req, link, data, **config):
        """Initialize the controller"""
        super(TopoController, self).__init__(req, link, data, **config)
        self.switch_app = data[switch_instance_name]

    #API to create the slice
    @route('creation_slice', PERS_REST_ENDPOINT + "/sliceCreation", methods=['POST'])
    def creation_slice(self, req, **kwargs):
        self.switch_app.logger.info("\nReceived a request to create a new slice\n")
        try:
            if req.body:
                req = req.json
            else:
                return Response(status="400", content_type='application/json', text=json.dumps({"status": "error", "message":"Empty value."}))
        except:
            return Response(status="400", content_type='application/json', text=json.dumps({"status": "error", "message":"Invalid format."}))

        if "name" in req and req["name"] in self.switch_app.sliceConfigs:
            return Response(status="409", content_type='application/json', text=json.dumps({"status": "error", "message":"Slice already present."}))
        else:
            #Add the new slice
            if "slice" in req:
                self.switch_app.sliceConfigs[req["name"]] = req["slice"]
                self.switch_app._change_slice(req["name"])
                #Save in the json file
                with open(template_file_path, "w") as template_file:
                    json.dump(self.switch_app.sliceConfigs, template_file)
                return Response(status="200", content_type='application/json', text=json.dumps({"status": "success", "message":"Slice added and configured"}))
            else: 
                return Response(status="400", content_type='application/json', text=json.dumps({"status": "error", "message":"Slice not defined."}))

    #API to delete the slice
    @route('deletion_slice', PERS_REST_ENDPOINT + "/sliceDeletion/{slicename}", methods=['DELETE'])
    def deletion_slice(self, req, slicename, **kwargs):
        self.switch_app.logger.info("\nReceived a request to delete current slice\n")
        #Impossible to delete default slice
        if slicename != "default":
            if slicename in self.switch_app.sliceConfigs:
                #If slice is active, restore the default slice
                if slicename == self.switch_app.sliceName:
                    self.switch_app._change_slice("default")
                del self.switch_app.sliceConfigs[slicename]
                #Remove the slice from the json file
                with open(template_file_path, "w") as template_file:
                    json.dump(self.switch_app.sliceConfigs, template_file)
                return Response(status="200", content_type='application/json', text=json.dumps({"status": "success", "message":"Slice deleted"}))
            else:
                return Response(status="409", content_type='application/json', text=json.dumps({"status": "error", "message":"Slice not present."}))
        else:
            return Response(status="409", content_type='application/json', text=json.dumps({"status": "error", "message":"Impossible to delete default slice."}))

    #API to change the slice
    @route('change_slice', PERS_REST_ENDPOINT + "/slice/{slicename}", methods=['GET'])
    def change_slice(self, req, slicename, **kwargs):
        self.switch_app.logger.info("\nReceived a request to change current slice\n")
        #Change the slice
        self.switch_app._change_slice(slicename)
        return Response(status="200", content_type='application/json', text=json.dumps({"status": "success", "message": "slice activated"}))

    #API to return active slice
    @route('get_active_slice_template', PERS_REST_ENDPOINT + "/activeSlice", methods=['GET'])
    def get_active_slice_template(self, req, **kwargs):
        self.switch_app.logger.info("\nReceived a request for the current slice\n")
        return Response(status="200", content_type='application/json', text=json.dumps({"status": "success", "message": {"slice_name": self.switch_app.sliceName, "slice" : self.switch_app.parse_active_ports()}}))

    #API to return the slice list
    @route('get_slices', PERS_REST_ENDPOINT + "/slices", methods=['GET'])
    def get_slices(self, req, **kwargs):
        self.switch_app.logger.info("\nReceived a request for all slices\n")
        return Response(status="200", content_type='application/json', text=json.dumps({"status": "success", "message":list(self.switch_app.sliceConfigs.keys())}))

    # for testing
    @route('get_ports', PERS_REST_ENDPOINT + "/ports", methods=['GET'])
    def get_ports(self, req, **kwargs):
        self.switch_app._get_ports()

    # for testing
    @route('enable_ports', PERS_REST_ENDPOINT + "/enablePorts", methods=['GET'])
    def enable_ports(self, req, **kwargs):
        self.switch_app._enable_ports()

    # for testing
    @route('disable_ports', PERS_REST_ENDPOINT + "/disablePorts", methods=['GET'])
    def disable_ports(self, req, **kwargs):
        self.switch_app._disable_ports()