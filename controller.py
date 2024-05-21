import json
import requests
import time 
from webob import Response
from ryu.controller.handler import MAIN_DISPATCHER, set_ev_cls
from ryu.ofproto import ofproto_v1_3
from ryu.lib import dpid as dpid_lib
from ryu.lib import stplib
from ryu.lib.packet import packet, ethernet, ether_types

from ryu.app.wsgi import ControllerBase, WSGIApplication, route
from ryu.controller import dpset
from ryu.app.simple_switch_13 import SimpleSwitch13

switch_instance_name = 'switch_api_app'

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

        config = {dpid_lib.str_to_dpid('0000000000000001'):
                  {'bridge': {'priority': 0x8000, 'fwd_delay': 8}},
                  dpid_lib.str_to_dpid('0000000000000002'):
                  {'bridge': {'priority': 0x9000, 'fwd_delay': 8}},
                  dpid_lib.str_to_dpid('0000000000000003'):
                  {'bridge': {'priority': 0xa000, 'fwd_delay': 8}},
                  dpid_lib.str_to_dpid('0000000000000004'):
                  {'bridge': {'priority': 0xb000, 'fwd_delay': 8}},
                  dpid_lib.str_to_dpid('0000000000000005'):
                  {'bridge': {'priority': 0xc000, 'fwd_delay': 8}},
                  dpid_lib.str_to_dpid('0000000000000006'):
                  {'bridge': {'priority': 0xd000, 'fwd_delay': 8}}}


        # Register the STP configuration
        self.stp.set_config(config)

        # Register the REST API
        wsgi.register(TopoController, {switch_instance_name: self})

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

        # Ignore LLDP packets - they are used for topology discovery
        if eth.ethertype == ether_types.ETH_TYPE_LLDP:
            return

        dpid = datapath.id
        self.mac_to_port.setdefault(dpid, {})

            
        # Learn a mac address to avoid FLOOD next time.
        self.mac_to_port[dpid][src] = in_port

        # If the destination is known, send the packet to the destination
        if dst in self.mac_to_port[dpid]:
            out_port = self.mac_to_port[dpid][dst]
        else:
            # Flood the packet to all possible ports (based on the slice restrictions)
            out_port = ofproto.OFPP_FLOOD

        # Create the actions list: send the packet to each port in out_port
        # actions = [parser.OFPActionOutput(int(out)) for out in out_port]
        actions = [parser.OFPActionOutput(out_port)]

        data = None
        if msg.buffer_id == ofproto.OFP_NO_BUFFER:
            data = msg.data

        out = parser.OFPPacketOut(datapath=datapath, buffer_id=msg.buffer_id,
                            in_port=in_port, actions=actions, data=data)
        datapath.send_msg(out)

    @set_ev_cls(stplib.EventTopologyChange, MAIN_DISPATCHER)
    def _topology_change_handler(self, ev):
        dp = ev.dp
        dpid_str = dpid_lib.dpid_to_str(dp.id)
        msg = 'Receive topology change event. Flush MAC table.'
        self.logger.debug("[dpid=%s] %s", dpid_str, msg)

        if dp.id in self.mac_to_port:
            self.delete_flow(dp)
            del self.mac_to_port[dp.id]

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
    
class TopoController(ControllerBase):
    def __init__(self, req, link, data, **config):
        """Initialize the controller"""
        super(TopoController, self).__init__(req, link, data, **config)
        self.switch_app = data[switch_instance_name]

